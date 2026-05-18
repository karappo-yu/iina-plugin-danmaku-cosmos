# 弹弹play 网络弹幕功能设计文档

## 1. 概述

为 Danmaku Cosmos 插件添加弹弹play（dandanplay）网络弹幕获取功能。用户打开视频时，插件自动通过弹弹play API 识别视频文件并匹配对应的弹幕库，下载弹幕后以 niconico 风格渲染。

### 核心原则

- 网络弹幕是**补充来源**，不替代本地弹幕
- 网络弹幕统一以 niconico 风格渲染（本插件的核心定位不变）
- 用户可控制网络弹幕的开关和优先级

## 2. IINA 插件联网要求

### 2.1 Info.json 声明

```json
{
  "permissions": ["network-request", "file-system", "show-osd", "video-overlay"],
  "allowedDomains": ["api.dandanplay.net", "*.dandanplay.net"]
}
```

- `network-request`：使用 `iina.http` 模块发 HTTP 请求（必须）
- `file-system`：缓存弹幕到本地目录（必须）
- `show-osd`：显示网络弹幕加载状态提示
- `video-overlay`：弹幕渲染（已有）
- `allowedDomains`：声明插件访问的域名，安装时提示用户

### 2.2 HTTP 请求方式

IINA 插件使用 `iina.http` 模块（非浏览器 `fetch`）：

```javascript
var http = iina.http;
var res = await http.get("https://api.dandanplay.net/api/v2/comment/12345", {
  headers: {
    "X-AppId": appId,
    "X-Timestamp": timestamp,
    "X-Signature": signature,
    "Accept": "application/json"
  }
});
var data = res.body; // JSON 对象
```

- `http.get()` / `http.post()` 返回 Promise，支持 async/await
- 请求头通过 `options.headers` 设置
- 响应体在 `res.body` 中（自动解析 JSON）
- `http.download(url, dest, options)` 可直接下载文件到本地

### 2.3 AppSecret 安全问题

弹弹play API 要求客户端应用使用签名验证模式（`X-AppId` + `X-Timestamp` + `X-Signature`），签名算法为 `base64(sha256(AppId + Timestamp + Path + AppSecret))`。

**问题**：本插件是开源项目，`AppSecret` 不能硬编码在代码中。

**解决方案**：
1. 在 `preferences.html` 中提供 AppId/AppSecret 配置入口
2. 用户自行申请或获取 AppId/AppSecret 后填入
3. 凭证存储在 IINA 插件 preferences 中（由 IINA 管理，不暴露在代码中）
4. 同时支持凭证模式（`X-AppId` + `X-AppSecret`）作为简化选项，适合不关心安全性的用户

## 3. 弹弹play API 调用流程

### 3.1 客户端调用流程（官方推荐）

```
打开视频 → 计算文件 hash → 调用 /api/v2/match 匹配 → 获取 episodeId
→ 调用 /api/v2/comment/{episodeId} 获取弹幕 → 转换格式 → 渲染
```

### 3.2 文件识别 API

**POST** `/api/v2/match`

请求体：
```json
{
  "fileName": "[SubGroup]AnimeTitle[01][1080p].mkv",
  "fileHash": "A1B2C3D4E5F6...",   // 4MB Ed2k hash
  "fileSize": 1234567890,
  "videoDuration": "00:24:00",
  "matchMode": 0                    // 0=hash+名称, 1=仅名称
}
```

响应：
```json
{
  "isMatched": true,
  "matches": [
    {
      "animeId": 18319,
      "animeTitle": "番剧标题",
      "episodeId": 123450001,
      "episodeTitle": "第1话"
    }
  ]
}
```

- `isMatched = true`：唯一匹配，可直接使用
- `isMatched = false`：多个候选，需用户选择
- 空列表：无法识别

### 3.3 搜索 API（备选）

**GET** `/api/v2/search/anime?keyword=关键词`

当文件识别失败时，用户可手动搜索番剧。

### 3.4 获取弹幕 API

**GET** `/api/v2/comment/{episodeId}?withRelated=true&chConvert=0`

- 返回 302 跳转到弹幕加速服务
- `withRelated=true`：同时获取关联第三方弹幕（B站等）
- `chConvert`：简繁转换（0=不转换，1=简体，2=繁体）

响应体（`CommentResponseV2`）：
```json
{
  "comments": [
    {
      "cid": 12345,
      "p": "12.34,1,16777215,1234567890",
      "m": "弹幕文本内容"
    }
  ]
}
```

字段 `p` 格式：`出现时间(秒),模式,颜色(十进制),用户ID`

弹幕模式：
- 1 = 普通滚动弹幕
- 4 = 底部弹幕
- 5 = 顶部弹幕

### 3.5 番剧详情 API

**GET** `/api/v2/bangumi/{bangumiId}`

获取番剧的剧集列表，用于手动选择集数。

## 4. 弹幕格式适配

### 4.1 弹弹play 格式 → 内部格式转换

弹弹play 弹幕格式与 Niconico 格式差异较大，需要转换：

| 字段 | 弹弹play | 内部格式 (input.js) |
|------|----------|-------------------|
| 时间 | `p[0]` 秒 (12.34) | `t` vpos (1/100秒, 1234) |
| 模式 | `p[1]` (1/4/5) | `m` (1=滚动,4=底部,5=顶部) |
| 颜色 | `p[2]` 十进制 (16777215) | `c` 十六进制 ("#ffffff") |
| 文本 | `m` | `text` |
| 字号 | 无（默认25） | `size` (25) |

转换规则：
```javascript
function convertDanDanPlayComment(ddpComment) {
  var parts = ddpComment.p.split(",");
  var timeSec = parseFloat(parts[0]);
  var mode = parseInt(parts[1]);
  var colorDec = parseInt(parts[2]);

  return {
    t: Math.round(timeSec * 100),     // 秒 → vpos
    m: mode,                           // 模式直接映射
    c: "#" + colorDec.toString(16).padStart(6, "0"), // 十进制 → 十六进制
    text: ddpComment.m,
    size: 25,
    _isOwner: false,
    _isFlash: false,
    _layer: -1
  };
}
```

### 4.2 模式映射

弹弹play 只有 3 种模式（1/4/5），远少于 Niconico 的 7 种。映射关系：

| 弹弹play 模式 | 含义 | Niconico 模式 | 渲染方式 |
|---------------|------|--------------|---------|
| 1 | 普通弹幕 | 1 (Naka) | 从右到左滚动 |
| 4 | 底部弹幕 | 4 (Shita) | 底部固定 |
| 5 | 顶部弹幕 | 5 (Ue) | 顶部固定 |

### 4.3 渲染路径

网络弹幕转换后走**插件自身的 CSS 渲染器**（`renderer.js` + `lane.js`），与 Bilibili XML 本地弹幕相同的渲染路径。不使用 niconicomments 库渲染。

理由：
- 弹弹play 弹幕格式简单（只有 mode 1/4/5），不需要 niconicomments 的复杂格式支持
- 插件自身的 CSS 渲染器对 mode 1/4/5 支持完善
- niconicomments 需要特定的 Niconico V1 JSON 数据结构，转换成本高

## 5. 弹幕缓存

### 5.1 缓存目录

网络弹幕下载后缓存到插件数据目录：

```
@data/danmaku-cache/
  └── {episodeId}.json          // 弹弹play 弹幕缓存
```

- `@data/` 是 IINA 插件的数据目录，由 `iina.file` 模块管理
- 文件名使用 `episodeId` 保证唯一性
- 缓存格式为转换后的内部格式 JSON，避免重复转换

### 5.2 缓存策略

- **首次加载**：从 API 下载，转换格式后写入缓存
- **再次加载**：优先读取缓存，跳过网络请求
- **缓存刷新**：用户手动触发，或缓存超过 24 小时自动刷新
- **缓存清理**：保留最近 50 个缓存文件，LRU 淘汰

### 5.3 缓存文件格式

```json
{
  "episodeId": 123450001,
  "animeTitle": "番剧标题",
  "episodeTitle": "第1话",
  "cachedAt": 1700000000000,
  "comments": [
    { "t": 1234, "m": 1, "c": "#ffffff", "text": "弹幕", "size": 25 }
  ]
}
```

## 6. Sidebar 设计

### 6.1 网络弹幕区域

在 sidebar 弹幕文件列表区域上方新增"网络弹幕"区块：

```
┌─────────────────────────────┐
│ 🌐 弹弹play 网络弹幕         │
│ ┌─────────────────────────┐ │
│ │ [开关] 自动匹配网络弹幕    │ │
│ │ 番剧：海贼王              │ │
│ │ 集数：第1话               │ │
│ │ 弹幕数：1234              │ │
│ │ [刷新] [手动搜索]         │ │
│ └─────────────────────────┘ │
├─────────────────────────────┤
│ 📁 本地弹幕文件              │
│ ┌─────────────────────────┐ │
│ │ video.json  ✓ 已加载     │ │
│ │ video.xml               │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

### 6.2 网络弹幕开关

- **默认关闭**：用户需要手动开启
- 开启后，每次打开视频自动调用匹配 API
- 关闭后，不发起任何网络请求
- 状态通过 `preferences` 持久化

### 6.3 手动搜索

当自动匹配失败时，用户可：
1. 点击"手动搜索"按钮
2. 输入番剧关键词
3. 从搜索结果中选择番剧和集数
4. 下载对应弹幕

### 6.4 高级设置新增项

在高级设置中新增：

| 设置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| 弹幕加载优先级 | 下拉选择 | 本地优先 | 本地优先 / 网络优先 / 仅本地 / 仅网络 |
| 简繁转换 | 下拉选择 | 不转换 | 不转换 / 转简体 / 转繁体 |
| 获取关联弹幕 | 开关 | 开启 | 是否获取 B站等第三方弹幕 |

## 7. 弹幕加载优先级

### 7.1 优先级选项

| 选项 | 行为 |
|------|------|
| **本地优先**（默认） | 有本地弹幕时使用本地，无本地时使用网络 |
| **网络优先** | 有网络弹幕时使用网络，无网络时使用本地 |
| **仅本地** | 不使用网络弹幕 |
| **仅网络** | 不使用本地弹幕 |

### 7.2 合并模式

当本地和网络弹幕同时存在时，可以选择：
- **替换**：仅使用优先级高的来源
- **合并**：同时显示本地和网络弹幕（可能重复）

默认为"替换"，合并模式作为高级选项。

## 8. 文件 Hash 计算

### 8.1 Ed2k Hash

弹弹play 文件识别使用 Ed2k hash（基于 MD4）。需要计算视频文件的 Ed2k hash。

**关键限制**：弹弹play 只使用文件前 4MB 内容计算 hash，不需要读取整个文件。

### 8.2 实现方式

IINA 插件运行在 JavaScriptCore 中，无法直接读取文件二进制内容。需要通过以下方式之一：

**方案 A：使用 `iina.file` 模块**
- `iina.file.read(path)` 可以读取文件，但可能不支持二进制模式
- 需要验证是否可以读取前 4MB 的二进制数据

**方案 B：使用 `iina.utils.exec()` 执行 shell 命令**
- 调用 `md4` 或 `openssl` 计算文件 hash
- macOS 自带 `openssl` 但不支持 md4
- 可能需要使用 Python 或其他工具辅助计算

**方案 C：仅使用文件名匹配（matchMode=1）**
- 不计算 hash，仅通过文件名匹配
- 匹配精度较低，但实现简单
- 可作为降级方案

**推荐方案**：优先尝试方案 A，失败则降级到方案 C。Hash 计算的具体实现需要在开发阶段验证。

## 9. 错误处理

### 9.1 网络错误

| 场景 | 处理 |
|------|------|
| 无网络连接 | 显示 OSD 提示，不阻塞播放 |
| API 请求超时 | 5 秒超时，显示提示 |
| API 返回 403 | 提示 AppId/AppSecret 配置错误 |
| API 返回空匹配 | 提示未找到匹配，建议手动搜索 |
| 服务器错误 | 静默失败，不影响本地弹幕 |

### 9.2 匹配错误

| 场景 | 处理 |
|------|------|
| 多个匹配结果 | 弹出选择界面让用户确认 |
| 匹配到错误的番剧 | 用户可手动搜索修正 |
| 集数识别错误 | 用户可在番剧详情中选择正确集数 |

## 10. 数据流

### 10.1 完整数据流

```
用户打开视频
    │
    ├─ 1. 本地弹幕匹配（现有逻辑）
    │     └─ 找到本地弹幕文件
    │
    ├─ 2. 网络弹幕匹配（新增，异步）
    │     ├─ 检查网络弹幕开关
    │     ├─ 检查缓存
    │     ├─ 计算文件 hash（如可能）
    │     ├─ 调用 /api/v2/match
    │     ├─ 获取 episodeId
    │     ├─ 调用 /api/v2/comment/{episodeId}
    │     ├─ 转换格式
    │     ├─ 写入缓存
    │     └─ 发送到 overlay
    │
    └─ 3. 按优先级决定最终加载
          ├─ 本地优先：本地有则用本地，否则用网络
          ├─ 网络优先：网络有则用网络，否则用本地
          ├─ 仅本地：忽略网络
          └─ 仅网络：忽略本地
```

### 10.2 消息通信

新增消息通道（通过 main.js 中转）：

| 消息 | 方向 | 数据 | 说明 |
|------|------|------|------|
| `dandanplay-toggle` | sidebar → main | `{ enabled: bool }` | 开关网络弹幕 |
| `dandanplay-search` | sidebar → main | `{ keyword: string }` | 手动搜索 |
| `dandanplay-select-episode` | sidebar → main | `{ episodeId: int }` | 选择集数 |
| `dandanplay-refresh` | sidebar → main | `{ episodeId: int }` | 刷新缓存 |
| `dandanplay-status` | main → sidebar | `{ state, animeTitle, episodeTitle, commentCount, error }` | 状态同步 |
| `dandanplay-search-result` | main → sidebar | `{ matches: [...] }` | 搜索结果 |
| `dandanplay-match-result` | main → overlay | `{ comments: [...], episodeId }` | 网络弹幕数据 |

## 11. Info.json 变更

```json
{
  "permissions": ["show-osd", "video-overlay", "network-request", "file-system"],
  "allowedDomains": ["api.dandanplay.net", "*.dandanplay.net"],
  "preferenceDefaults": {
    "danmakuEnabled": true,
    "danmakuCanvasOpacity": 0.8,
    "niconicommentsFontScale": 1.0,
    "canvasMode": "default",
    "strokeColor": "#000000",
    "strokeInversionColor": "#ffffff",
    "strokeOpacity": 0.4,
    "strokeWidth": 2.8,
    "commentLimit": 0,
    "scrollSpeed": 0.95,
    "dandanplayEnabled": false,
    "dandanplayAppId": "",
    "dandanplayAppSecret": "",
    "dandanplayPriority": "local-first",
    "dandanplayChConvert": 0,
    "dandanplayWithRelated": true,
    "dandanplayAutoMatch": true
  }
}
```

## 12. 开发计划

### Phase 1：基础架构
1. 更新 Info.json（permissions、allowedDomains、preferenceDefaults）
2. 实现 AppId/AppSecret 配置（preferences.html）
3. 实现签名计算工具函数
4. 实现基础 HTTP 请求封装

### Phase 2：API 集成
5. 实现文件匹配 API 调用
6. 实现弹幕获取 API 调用
7. 实现格式转换（弹弹play → 内部格式）
8. 实现缓存读写

### Phase 3：Sidebar UI
9. 网络弹幕区块 UI
10. 开关、状态显示
11. 手动搜索功能
12. 优先级设置

### Phase 4：渲染集成
13. 网络弹幕发送到 overlay
14. 优先级逻辑实现
15. 合并模式（可选）

### Phase 5：边界情况
16. 错误处理完善
17. 多匹配结果选择
18. 缓存清理策略
19. Hash 计算验证

## 13. 风险与注意事项

1. **AppSecret 安全**：开源项目中无法安全存储密钥，需要用户自行配置
2. **API 频率限制**：弹弹play 可能对 API 调用频率有限制，需要合理控制请求频率
3. **Hash 计算可行性**：IINA 插件环境的文件读取能力有限，Ed2k hash 计算可能需要降级到文件名匹配
4. **302 跳转**：弹幕获取 API 返回 302 跳转，需确认 `iina.http` 是否自动跟随重定向
5. **弹幕重复**：本地弹幕和网络弹幕可能内容重复，合并模式需要去重策略
6. **性能**：网络请求不应阻塞本地弹幕加载，应异步进行
7. **离线场景**：无网络时不应影响本地弹幕功能
8. **弹弹play 弹幕风格**：弹弹play 弹幕以中文为主，渲染为 niconico 风格后视觉效果可能不如弹弹play 原生风格，但符合本插件的定位
