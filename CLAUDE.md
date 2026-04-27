# Danmaku Cosmos — 项目指南

## 项目概述

IINA 弹幕插件，支持 Niconico（XML / V1 JSON）和 Bilibili（XML）两种格式弹幕，提供 CSS 和 Canvas 双渲染模式。

## 技术约束

- **IINA 插件环境**：不支持任何构建工具 / 打包工具 / npm 包管理
- **渲染引擎**：IINA 使用 Safari (WebKit) 内核
- **语言**：纯原生 JavaScript（ES5/ES6 混用），无 TypeScript
- **模块化**：overlay 文件通过 `<script>` 标签顺序加载，通过 `window` 对象共享全局函数和变量。`main.js`（插件入口）和 `sidebar/`（侧边栏）各自独立运行

## 项目结构

```
Danmaku Cosmos/
├── Info.json                 # 插件元数据 & 偏好设置默认值
├── main.js                   # 插件主入口（IINA API 调用、文件加载、消息中转）
├── global.js                 # 全局入口（仅日志）
├── preferences.html          # IINA 偏好设置页面（CSS 字体三件套）
├── overlay/                  # 弹幕渲染层（WebView 容器）
│   ├── index.html            # 加载入口
│   ├── index.css             # 渲染样式 & 动画定义
│   ├── main.js               # 引擎主入口：消息处理、渲染模式切换、状态管理
│   ├── renderer.js           # CSS 模式：DOM 创建、对象池、弹幕布局
│   ├── lane.js               # 轨道分配与管理（多层偏移碰撞检测）
│   ├── config.js             # 全局常量（颜色、字体、字号映射）
│   ├── command.js            # mail/commands 命令解析
│   ├── flash.js              # Flash 弹幕文字预处理（上下标 ruby）
│   ├── nicoscript.js         # Nicoscript 解析（逆/速度/默认/禁止/跳转/替换）
│   ├── input.js              # 三种格式的弹幕数据解析
│   ├── ca-score.js           # Comment Art 评分与层分离
│   └── lib/                  # 第三方库（只读，不修改）
│       ├── niconicomments.min.js
│       ├── niconicomments-plugin-niwango.min.js
│       └── niwango.min.js
├── sidebar/                  # IINA 侧边栏控制面板
│   ├── index.html
│   ├── index.css
│   └── index.js
└── .github/workflows/       # Release 打包发布
```

## 架构关键约定

### 消息通信机制（核心模式）

插件内所有通信通过 `postMessage` / `onMessage` 完成，分为三条通道：

| 通道 | 方向 | 用途 |
|------|------|------|
| `main.js ↔ overlay` | 双向 | 弹幕数据、时间更新、渲染参数、渲染模式切换 |
| `main.js ↔ sidebar` | 双向 | 侧边栏 UI 状态同步、操作指令 |
| `overlay ↔ main.js` | overlay → main | canvas 不支持通知、跳转指令、seek 状态 |
| `sidebar ↔ main.js` | sidebar → main | toggle、参数变更、文件操作 |

**重要**：overlay 和 sidebar **不直接通信**，均通过 `main.js` 中转。

**sidebar 懒加载**：IINA 侧边栏 Tab 是懒加载的，用户点开前 sidebar WebView 不存在。因此 sidebar 采用**拉模式**同步状态：
1. sidebar 加载完成后主动发 `request-state`
2. `main.js` 在 `request-state` 回调中一次性推送当前完整状态
3. 后续状态变更走事件驱动的增量 `sidebar.postMessage` 更新
4. 不要假设 `main.js` 可以在初始化时主动向 sidebar 推送消息

### overlay 脚本加载顺序（不可变）

```
niconicomments.min.js → niconicomments-plugin-niwango.min.js → niwango.min.js
→ config.js → command.js → flash.js → nicoscript.js → lane.js → renderer.js → input.js → ca-score.js → main.js
```

后面的脚本依赖前面脚本在 `window` 上挂载的函数（如 `parseMailCommands`、`window.setRendererConfig`、`window.getFreeScrollLane`）。修改时注意不要破坏加载顺序。

### 数据格式

- **弹幕数据对象** 统一字段约定（`input.js` 中创建）：
  - `t` — vpos 时间（1/100 秒）
  - `m` — 模式（1-7）
  - `c` — 颜色 hex
  - `text` — 显示文本
  - `size` — 字号
  - `_isOwner` — 是否投稿者
  - `_isFlash` — 是否 Flash 弹幕
  - `_layer` — CA 层 ID（-1 为默认层）
  - `_lane` / `_offsetLevel` / `_forced` — 轨道分配结果（运行时赋值）
  - `font` / `invisible` / `live` / `full` / `ender` / `patissier` / `durationSec` 等

- **通信编码**：弹幕 XML/JSON 内容在 `main.js` 中通过 `encodeURIComponent()`（函数名 `encodeContent`）编码后发送到 overlay，overlay 侧 `decodeURIComponent()` 还原。不要改动此编码协议，除非整体替换（需确保两端一致）。

### CSS 模式渲染流程

1. `time-update` 每次收到时间更新 → `main.js` 遍历 `allDanmaku` 查找 ≤ 当前时间的弹幕
2. `createDanmaku()` 从对象池（`danmakuPool`）获取 DOM 元素，设置样式属性
3. 轨道分配（`lane.js`）：先查 Level 0，逐级尝试 Level 1/2，最后回退强制
4. CSS animation 驱动动画，`animationend` 事件触发回收弹幕到对象池

### Canvas 模式

基于 `niconicomments` 第三方库，只在 Niconico V1 JSON 格式下可用。不建议深入修改 Canvas 模式的内部逻辑。

## 编码规范

- **变量声明**：`var`（main.js / sidebar）和 `let`（overlay）混用是现状，新代码建议统一用 `let`
- **命名**：camelCase。私有/运行时字段前缀 `_`（如 `_layer`, `_lane`）
- **DOM 操作**：弹幕 DOM 元素必须从对象池获取（`getDanmakuElement()`），用完归还（`recycleDanmakuElement()`）。禁止直接 `createElement` / `removeChild`
- **通信**：`iina.postMessage(key, value)` / `iina.onMessage(key, callback)` 是标准模式，保持命名一致
- **弹幕开关**：使用 `toggleDanmaku()` 或 `ensureDanmakuEnabled()` 共享函数，不要手动重复 `preferences.set` + `overlay.postMessage` 逻辑

## 已知限制

- `canvas.width = 1920; canvas.height = 1080` 硬编码，不动态适应窗口比例
- 文件名含 `[` `]` 特殊字符可能导致自动加载失败（`extractEpisodeNumber` 的正则匹配问题）
- 最小化窗口后恢复会触发全量 `handleSeek` 重渲染
- Canvas 模式下 CSS 模式的特有设置（字体缩放、滚动时长、屏蔽、轨道限制）不可用
- `preferences.sync()` 每次变更都调用，未做防抖

## 避免的操作

- ❌ 不要引入任何构建工具 / npm 打包流程
- ❌ 不要修改 `overlay/lib/` 中的第三方库文件
- ❌ 不要在 overlay 和 sidebar 之间直接建立通信通道
- ❌ 不要移除 HTML 中 `<script>` 的加载顺序依赖
- ❌ 不要在生产代码中使用 `console.log` 高频率输出（`time-update` 回调中尤其禁止）
- ❌ 不要直接创建/移除弹幕 DOM 元素，必须通过对象池
