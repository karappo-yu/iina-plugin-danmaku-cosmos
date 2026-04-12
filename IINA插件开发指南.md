# IINA 插件开发指南

## 一、基础架构

### 1.1 窗口、播放器与入口点

IINA 可以同时打开多个窗口，每个窗口关联一个 **播放器（Player）**，播放器之间相互独立，拥有各自的 mpv 实例和插件实例，不共享任何数据。

插件从 **入口点（Entry Point）** 开始执行，入口点是一个 JavaScript 文件，有两种类型：

| 入口类型 | 说明 |
|---|---|
| **Main Entry（主入口）** | 在播放器上下文中执行，每个播放器创建一个插件实例，可直接控制该播放器 |
| **Global Entry（全局入口）** | 不关联任何播放器，整个 IINA 只有一个全局实例，启动时执行，可在无视频播放时显示窗口和菜单 |

全局实例无法直接控制播放器，但可以创建托管播放器，并与主入口实例通信，从而间接控制播放器。

**执行时序：**
```
Player 创建 → 插件代码执行 → 用户打开文件 → 文件开始播放
```

> ⚠️ 入口文件在打开视频之前执行。初始化代码（如注册字幕下载器、添加菜单项、创建自定义窗口）可直接写在入口文件中，但运行时操作需要使用事件监听。例如，需要在视频文件打开时执行操作，应监听 `"mpv.file-loaded"` 事件。

### 1.2 插件结构

插件是一个包含 `Info.json` 文件和其他 JavaScript 文件及资源的文件夹，文件夹扩展名应为 `.iinaplugin`（在 macOS 上显示为包，右键"显示包内容"可打开）。

最简插件示例：

```json
// Info.json
{
  "name": "My Plugin",
  "identifier": "com.example.myplugin",
  "version": "1.0.0",
  "entry": "main.js"
}
```

```javascript
// main.js
iina.console.log("Hello, world!");
```

### 1.3 编写插件代码

所有 IINA API 通过 `iina` 对象暴露，方法按模块分组（如 `iina.console`、`iina.menu`）。建议解构使用：

```javascript
const { console, core, event } = iina;

console.log("Hello, world!");

event.on("mpv.file-loaded", () => {
  core.osd("Starts playing");
});
```

### 1.4 JavaScript 版本支持

IINA 使用 **JavaScriptCore** 引擎（与 Safari 相同），不同 macOS 版本对应不同的 JavaScriptCore 版本。

- IINA 1.3.2 最低支持 macOS 10.11，对应 Safari 9
- **基线：可使用大部分 ES6 特性**
- 可使用 [caniuse](https://caniuse.com) 查询特性支持情况（macOS 10.11 → Safari 9，10.12 → Safari 10，以此类推）
- 推荐使用 Babel 等转译器将代码编译为 ES6
- 使用 TypeScript 或 React/Vue 等框架时，必须使用打包工具

---

## 二、Info.json 结构

### 2.1 必填字段

| 字段 | 说明 |
|---|---|
| `name` | 插件名称，显示在 IINA 偏好设置的插件列表中 |
| `version` | 插件版本，格式为 `major.minor.patch`，如 `1.0.0` |
| `identifier` | 唯一标识符，格式为反向域名，如 `com.example.myplugin` |
| `author` | 作者信息，包含 `name`（必填）、`email`（可选）、`url`（可选） |
| `entry` | 主入口文件路径，相对于插件文件夹 |

### 2.2 可选字段

| 字段 | 说明 |
|---|---|
| `description` | 插件简短描述 |
| `globalEntry` | 全局入口文件路径，相对于插件文件夹 |
| `preferencesPage` | 偏好设置页面路径（HTML），显示在 IINA 偏好设置中 |
| `preferenceDefaults` | 偏好设置的默认值 |
| `helpPage` | 帮助页面路径，可以是插件内的 HTML 文件或外部 URL |
| `subProviders` | 要注册的字幕提供者数组 |
| `sidebarTab` | 侧边栏标签信息字典，含 `name`（标签标题）字段 |
| `permissions` | 插件所需权限数组 |
| `allowedDomains` | 插件可访问的域名数组，如 `["*"]` 允许访问所有域名 |
| `ghRepo` | GitHub 仓库，格式为 `username/repo`，用于自动检查更新 |
| `ghVersion` | 整数，每次发布新版本时递增，IINA 用此数字与 GitHub 最新代码比较以检查更新 |

---

## 三、插件权限

插件需在 `Info.json` 中声明所需权限，安装时 IINA 会向用户展示这些权限：

| 权限 | 说明 | 对应 API |
|---|---|---|
| `show-osd` | 显示 OSD 消息 | `iina.core.osd()` |
| `show-alert` | 显示原生警告对话框 | `iina.utils` 相关方法 |
| `video-overlay` | 在视频覆盖层上绘制 | `iina.overlay` 模块 |
| `network-request` | 访问网络 | `iina.http` 模块 |
| `file-system` | 访问文件系统 | `iina.file` 模块或 `iina.utils.exec()` 执行外部程序 |

---

## 四、类型定义

安装 `iina-plugin-definition` 包可获取 TypeScript/JavaScript 类型定义：

```bash
npm install --save-dev iina-plugin-definition
```

配置 `tsconfig.json`（或 `jsconfig.json`）：

```json
{
  "compilerOptions": {
    "lib": ["es6", "es7", "esnext"],
    "sourceMap": false,
    "target": "es6",
    "module": "es6",
    "typeRoots": [
      "./node_modules/@types",
      "./node_modules/iina-plugin-definition"
    ]
  },
  "compileOnSave": false
}
```

> ⚠️ `lib` 中不要包含 `"DOM"`，因为 IINA 不提供浏览器环境。

---

## 五、浏览器 API 等价物

插件代码不在浏览器中运行，没有 `window` 对象，以下常见浏览器 API 不可用：

| 浏览器 API | IINA 替代方案 |
|---|---|
| `fetch()` | `iina.http` 模块 |
| `prompt()` | `iina.utils.ask()` |
| `localStorage` | `iina.file` 模块（访问文件系统） |
| `console` | `iina.console` 模块 |

**定时器方法** IINA 提供了等价实现，可直接使用：

- `setTimeout()` / `clearTimeout()`
- `setInterval()` / `clearInterval()`

---

## 六、JavaScript 模块系统

ES6 模块（`import`/`export`）在 JavaScriptCore 上不完全支持，尤其在早期 macOS 版本上。IINA 提供了一个 Node 风格的基础模块系统：

**入口文件中导入：**
```javascript
const { foo } = require("./foo.js");
```

**其他文件中导出：**
```javascript
module.exports = {
  foo: "bar",
};
```

> ⚠️ 此模块系统非常基础，不支持更多特性。如需使用 ES6 模块等高级功能，请使用打包工具（如 Parcel、Webpack）。

---

## 七、使用打包工具

使用打包工具可以将插件代码打包为单个文件，带来以下好处：

- 使用 ES6 模块和现代 JavaScript 特性
- 使用第三方库
- 使用完整的 Web 开发技术栈开发自定义 UI（如 React、Vue、TypeScript）

IINA 推荐使用 **Parcel** 打包，官方插件模板已预配置好 Parcel。

### 7.1 配置 Targets

在 `package.json` 中添加 targets：

**入口文件 Target：**
```json
{
  "targets": {
    "entry": {
      "distDir": "./dist/",
      "source": "src/index.ts",
      "isLibrary": false
    }
  }
}
```

上述配置将 `src/index.ts`（及其所有导入文件）打包到 `dist/index.js`，即可将 `dist/index.js` 作为插件入口文件。

**自定义 UI Target：**
```json
{
  "targets": {
    "ui": {
      "distDir": "./dist/ui/",
      "source": "src/ui/index.html"
    }
  }
}
```

在 `src/ui/index.html` 中导入包含 React 代码的 JavaScript 文件，然后加载 `dist/ui/index.html` 即可显示自定义 UI。

---

## 八、调试

### 8.1 插件重载

开发时可通过符号链接将插件文件夹链接到 `~/Library/Application Support/IINA/Plugins/`，无需每次重新安装。目标路径必须使用 `.iinaplugin-dev` 后缀：

```bash
ln -s /path/to/myplugin ~/Library/Application\ Support/com.colliderli.iina/plugins/myplugin.iinaplugin-dev
```

> 💡 使用 `iina-plugin` CLI 工具时，可执行 `iina-plugin link <dir>` 自动创建符号链接。

修改代码（或使用打包工具构建）后，重启 IINA 即可重载插件。

对于 WebView，可在右键菜单中选择 **Reload** 重载，无需重启 IINA。

### 8.2 日志查看器

从 IINA 1.3.2 起，可通过 **Window > Log Viewer** 查看所有 IINA 日志子系统的日志。

- 启动时 IINA 加载插件文件夹中的所有插件，日志中会显示 `Loading JS plugin from /path/to/plugin`
- 加载过程中的错误也会在此显示
- 可选择插件的日志子系统：
  - 全局实例：`global - <插件名>`
  - 播放器实例：`player<id> - <插件名>`
- 使用 `iina.console` 模块打印的日志会显示在日志查看器中

### 8.3 JS 开发者工具

从 IINA 1.4.0 起，可通过 **Plugin > Developer Tool** 在任意插件的上下文中运行 JavaScript 控制台。

- 类似浏览器的 JavaScript 控制台
- 可访问所有 IINA API 和插件中的全局变量
- 可检查 IINA API 的返回值并测试代码

### 8.4 Safari Web 检查器

如需更高级的调试功能，可使用 Safari Web 检查器：

1. 在 Safari 偏好设置 > 高级中启用"开发"菜单
2. 启动 IINA 后，在 Safari 中选择 **Develop > (你的电脑名称)**，选择要调试的 JavaScript 上下文
3. 将打开 Web 检查器窗口，可设置断点、检查变量、使用控制台

---

## 九、全局入口点

每个 IINA 播放器核心相互隔离，拥有各自的窗口、mpv 实例和插件实例，普通插件无法直接与其他播放器核心通信。但有时需要控制多个播放器窗口（如同步多个视频的播放），此时可使用 **全局入口点** 和 `global` 模块。

### 9.1 全局入口

在 `Info.json` 中指定全局入口：

```json
{
  "global": "global.js"
}
```

此文件在 IINA 启动时加载，早于任何播放器核心的初始化。

IINA 会为插件创建一个 **全局插件实例**，在其中加载全局入口脚本。全局插件实例与播放器核心实例（加载主入口脚本）相互隔离。

> ⚠️ 全局插件实例不关联任何播放器核心，因此**不能使用** `core` 和 `mpv` 等 API 模块。但可以使用 `global` 模块来控制和与主入口脚本通信。

全局入口脚本拥有自己的菜单，并能创建独立窗口，因此用户即使在没有播放视频时也能访问菜单项和用户界面。

### 9.2 创建播放器核心

全局入口脚本可使用 `global` 模块创建新的播放器核心：

```javascript
const player = global.createPlayerInstance({
  url: "/path/to/video.mp4",
  disableWindowAnimation: true,
  disableUI: true,
  enablePlugins: false,
});
```

| 参数 | 说明 |
|---|---|
| `disableWindowAnimation` | 禁用窗口调整大小的动画 |
| `disableUI` | 隐藏标题栏和屏幕控制（OSC） |
| `enablePlugins` | 是否在新建的播放器中启用插件 |

这些选项适用于创建编程控制的播放器窗口，如演示和视频墙场景。

### 9.3 与播放器核心通信

全局入口脚本使用类似 WebView 的消息传递机制与播放器核心中的主入口脚本通信。

**全局 → 播放器（发送消息）：**

```javascript
// 发送给所有播放器
global.postMessage(null, "message-name", data);

// 发送给托管播放器
const player = global.createPlayerInstance({ ... });
global.postMessage(player, "message-name", data);
```

`global.postMessage()` 接受三个参数：

| 参数 | 说明 |
|---|---|
| 目标播放器 | `null` 表示发送给所有播放器；数字为 `createPlayerInstance()` 的返回值；字符串为播放器 ID |
| 消息名称 | 字符串，标识消息类型 |
| 消息数据 | 任意数据 |

**全局 ← 播放器（接收消息）：**

```javascript
global.onMessage("message-name", (data, playerID) => {
  // 处理消息，playerID 可用于回复
  global.postMessage(playerID, "reply-message", replyData);
});
```

回调函数接收两个参数：消息数据和发送方的播放器 ID，便于回复。

**播放器端（主入口脚本）：**

```javascript
// 发送消息给全局入口
global.postMessage("message-name", data);

// 接收来自全局入口的消息
global.onMessage("message-name", (data) => {
  // 处理消息
});
```

> 💡 播放器端的 `global.postMessage()` 只需两个参数（消息名称和数据），因为全局实例只有一个，无需指定目标。

---

## 十、WebView

IINA 提供多种创建自定义用户界面的方式：StandaloneWindow、Sidebar 和 Overlay，它们都基于 WebView。

### 10.1 加载 HTML

需要准备一个包含 CSS（和可能的 JavaScript）的 HTML 文件来创建自定义 UI。通过各模块的 `loadFile()` 方法加载，路径相对于插件根目录。

HTML 页面可以包含：
- 内联 `<style>` 或 `<script>` 标签
- 外部文件（本地文件或远程 URL）
- 本地文件路径相对于 HTML 页面本身

### 10.2 简单模式

如果只需要简单 UI（如在覆盖层显示统计信息），可使用简单模式，无需准备 HTML 文件或调用 `loadFile`：

```javascript
const { overlay } = iina;

overlay.simpleMode();
overlay.setStyle(`
  body {
    color: green;
  }
`);
setInterval(() => {
  overlay.setContent(`
    <p>Current time: ${core.status.position}</p>
  `);
}, 1000);
```

| 方法 | 说明 |
|---|---|
| `simpleMode()` | 启用简单模式 |
| `setStyle(css)` | 设置 CSS 样式 |
| `setContent(html)` | 设置 HTML 内容 |

### 10.3 WebView 与插件脚本的通信

**关键概念：WebView 是独立于 IINA 主进程的单独进程**，WebView 无法直接访问插件脚本的 JavaScript 上下文，反之亦然。WebView 中的 JavaScript 代码不能直接调用 IINA API。

通信通过 `postMessage()` 和 `onMessage()` 方法实现：

```
┌─────────────────┐    postMessage    ┌─────────────────┐
│   插件脚本       │ ───────────────→ │   WebView        │
│ (overlay, etc.)  │ ←─────────────── │ (iina 对象)      │
│                  │    onMessage      │                  │
└─────────────────┘                   └─────────────────┘
```

**插件脚本端：**

| 方法 | 说明 |
|---|---|
| `overlay.postMessage(name, data)` | 向 overlay WebView 发送消息 |
| `overlay.onMessage(name, handler)` | 接收来自 overlay WebView 的消息 |
| `sidebar.postMessage(name, data)` | 向 sidebar WebView 发送消息 |
| `sidebar.onMessage(name, handler)` | 接收来自 sidebar WebView 的消息 |
| `standaloneWindow.postMessage(name, data)` | 向独立窗口 WebView 发送消息 |
| `standaloneWindow.onMessage(name, handler)` | 接收来自独立窗口 WebView 的消息 |

**WebView 端：**

| 方法 | 说明 |
|---|---|
| `iina.postMessage(name, data)` | 向插件脚本发送消息 |
| `iina.onMessage(name, handler)` | 接收来自插件脚本的消息 |

> 💡 如果有多个 WebView（如 sidebar 和 overlay）需要互相通信，必须先将消息发送到插件脚本，再由插件脚本转发到另一个 WebView。

### 10.4 消息格式

```typescript
postMessage(name: string, data?: any): void;
onMessage(name: string, handler: (data: any) => void): void;
```

| 参数 | 说明 |
|---|---|
| `name` | 消息名称，用于区分不同消息 |
| `data` | 消息数据，必须是 **JSON 可序列化对象** |

**JSON 可序列化要求：**
- ✅ 允许：`string`、`number`、`object`、`array`（不含循环引用）
- ❌ 不允许：`Date`、`RegExp`、`Map`、`Set`、`Function`、`Symbol`、`BigInt`、`ArrayBuffer`、循环引用

### 10.5 示例：侧边栏播放控制

以下示例演示如何使用 WebView 消息 API 在侧边栏中显示视频当前时间和播放/暂停按钮。

**侧边栏 HTML：**
```html
<div id="time">00:00:00</div>
<button id="play-pause">Play</button>
```

**插件脚本 — 发送状态更新：**
```javascript
const { core, sidebar } = iina;

function postUpdate() {
  sidebar.postMessage("update", {
    time: core.status.position,
    paused: core.status.paused,
  });
}

setInterval(postUpdate, 500);
```

> 💡 实际应用中可使用更精细的方式（如监听 mpv 的 position 和 pause 属性变更事件）来按需更新 UI。

**侧边栏 WebView — 接收更新：**
```javascript
iina.onMessage("update", ({ time, paused }) => {
  document.getElementById("time").innerText = time;
  document.getElementById("play-pause").innerText = paused ? "Play" : "Pause";
});
```

**侧边栏 WebView — 按钮点击发送消息：**
```javascript
document.getElementById("play-pause").addEventListener("click", () => {
  iina.postMessage("toggle-pause");
});
```

**插件脚本 — 处理按钮消息：**
```javascript
sidebar.onMessage("toggle-pause", () => {
  core.togglePause();
});
```

### 10.6 支持浅色/深色外观

UI 应同时支持浅色和深色外观，使用 CSS 变量和 `prefers-color-scheme` 媒体查询：

```css
body {
  color: var(--text-color);
}

@media (prefers-color-scheme: light) {
  :root {
    --text-color: black;
  }
}

@media (prefers-color-scheme: dark) {
  :root {
    --text-color: white;
  }
}
```

> 💡 所有 WebView 的背景色是透明的，会自动适应系统外观（跟随窗口背景），通常不需要在 CSS 中指定背景色。

### 10.7 启用 Overlay WebView 的交互

默认情况下，overlay 不可交互（用户无法点击链接/按钮或选择文本），因为 WebView 可能会吸收所有输入事件，干扰 IINA 正常操作。

**启用交互：**
```javascript
overlay.setClickable(true);
```

启用后，必须为可点击的 HTML 元素添加 `data-clickable` 属性：

```html
<button id="open-btn" data-clickable>Click Me</button>
<input type="text" id="input" data-clickable />
```

> ⚠️ 不要过度使用此功能，可点击元素的命中测试效率不高（尽管对大多数用例性能影响可忽略）。

**使用 `data-clickable` 与输入控件的注意事项：**

当输入框获得焦点时，会捕获所有键盘输入事件，而用户无法通过点击外部区域轻松取消焦点。JavaScript 代码应正确处理此情况，例如：
- 让用户点击按钮提交输入
- 接受输入后手动调用 `blur()` 取消焦点

**使用完毕后应禁用交互：**
```javascript
overlay.setClickable(false);
```

---

## 十一、字幕提供者

`subtitles` 模块提供 API 用于注册外部字幕提供者，集成到 IINA 的字幕搜索和下载系统中。注册后的字幕提供者可在 IINA 的设置和 **Subtitles > Find Online Subtitles** 菜单中使用。

### 11.1 注册字幕提供者

**1. 在 Info.json 中声明：**

```json
{
  "subtitleProviders": [
    {
      "id": "open-sub",
      "name": "OpenSubtitles"
    }
  ]
}
```

| 字段 | 说明 |
|---|---|
| `id` | 唯一标识符字符串 |
| `name` | 显示名称，用于设置和菜单中 |

一个插件可注册多个字幕提供者，只要 ID 不同即可。

**2. 在主入口脚本中注册：**

```javascript
subtitles.registerProvider("open-sub", {
  search: async (query) => {
    // ...
  },
  description: (item) => {
    // ...
  },
  download: async (item) => {
    // ...
  },
});
```

> ⚠️ `subtitles.registerProvider()` 必须在主入口脚本中直接调用（即播放器核心初始化时），不能放在事件监听中。

**Provider 对象的三个字段：**

| 方法 | 说明 |
|---|---|
| `search()` | 搜索入口，用户搜索字幕时调用。应收集信息、搜索字幕，返回 `SubtitleItem` 列表 |
| `description()` | 给定 `SubtitleItem`，返回三个描述标签，显示在搜索结果列表中 |
| `download()` | 给定 `SubtitleItem`，下载字幕文件并返回文件路径列表 |

**完整工作流：**
```
用户搜索 → search() → 返回 SubtitleItem 列表
         → description() 为每项生成描述标签 → 显示搜索结果
用户选择 → download() → 下载字幕文件 → 返回文件路径
```

### 11.2 搜索字幕

`search()` 函数是字幕搜索请求的起点，应为 async 函数或返回 Promise。

**获取视频信息：**

函数不接收参数，但可通过 IINA API 获取当前视频的所有信息：

| 信息 | API |
|---|---|
| 当前文件 URL | `core.status.url` |
| 在线视频标题 | `core.status.title` |
| 文件哈希值 | 使用 `file` 模块读取文件块计算 |
| 用户输入关键词 | `utils.prompt()` |

**发起搜索请求：**

| 方式 | API |
|---|---|
| HTTP/XMLRPC 请求 | `http` 模块 |
| 外部可执行文件 | 包含在插件包中，使用 `utils.exec()` 调用 |

**返回 SubtitleItem 列表：**

`SubtitleItem` 是包含任意数据对象的包装器，通过 `subtitle.item(data)` 创建：

```javascript
const results = [
  { id: "123456", title: "Subtitle 1", lang: "en", format: "srt", score: 0.9 },
  { id: "654321", title: "Subtitle 2", lang: "en", format: "ass", score: 0.8 },
];

const items = results.map((x) => subtitle.item(x));

console.log(items[0].data.id);
// "123456"
```

`data` 对象可以是任意内容，封装后的 `SubtitleItem` 会传递给后续的 `description()` 和 `download()` 函数。

### 11.3 显示搜索结果

`description()` 方法指定如何在 IINA 界面中显示 SubtitleItem。IINA 为每条字幕显示一个主标签和两个辅助标签。

返回值应为包含三个字段的对象：

| 字段 | 说明 |
|---|---|
| `name` | 主标签（标题） |
| `left` | 左侧辅助标签 |
| `right` | 右侧辅助标签 |

```javascript
{
  description: (item) => ({
    name: item.title,
    left: `${item.lang} ${item.format}`,
    right: `Rating: ${item.score * 10}`,
  });
}
```

### 11.4 下载字幕文件

用户从列表中选择字幕后，IINA 调用 `download()` 方法。该方法应执行下载并返回下载的字幕文件路径数组（某些字幕提供者可能为单条字幕提供多个文件，但大多数情况下数组只包含一个路径）。

**推荐使用 `@tmp/` 伪目录：**

```javascript
{
  download: async (item) => {
    const url = `https://example.com/subtitle/${item.id}`;
    const path = await http.download(url, "@tmp/");
    return [path];
  },
}
```

> 💡 `@tmp/` 是插件的临时目录，播放器退出后会自动清理。IINA 会在用户选择保存字幕时将文件移动到视频文件目录。虽然也可以直接下载到视频文件目录，但推荐使用 `@tmp/`。

可使用 `http` 模块下载文件，或使用 `utils.exec()` 调用外部可执行文件。

### 11.5 使用自定义用户界面

字幕提供者可以提供自定义 UI 来展示搜索结果，而非使用 IINA 内置的结果列表。

在 `search()` 方法中返回 `subtitle.CUSTOM_IMPLEMENTATION`，IINA 将不再调用 `description()` 和 `download()`，插件可使用 `sidebar` 或 `standaloneWindow` 模块创建自定义界面：

```javascript
subtitle.registerProvider("open-sub", {
  search: async () => {
    // ...自定义搜索逻辑
    return subtitle.CUSTOM_IMPLEMENTATION;
  },
  description: (item) => {
    return null;
  },
  download: async (item) => {
    return null;
  },
});
console.log("Sub provider registered");
```

---

## 十二、插件偏好设置

IINA 为插件提供集成的偏好设置面板，用户可在设置窗口中选择插件，点击 Preferences 标签页访问。

### 12.1 配置偏好设置页面

在 `Info.json` 中指定偏好设置页面：

```json
{
  "preferencesPage": "preferences.html"
}
```

### 12.2 偏好设置页面样式

鼓励使用默认 HTML 输入元素和最小化样式，以保持与 macOS 界面的一致性。

IINA 默认提供的 CSS 样式包括：
- 深色模式支持
- 字体和字号
- 工具类：

```css
small,
.small {
  font-size: 11px;
}

.secondary {
  color: rgba(0, 0, 0, 0.5);
}

.pref-help {
  margin-top: 2px;
}

.pref-section {
  margin-bottom: 12px;
}
```

**使用示例：**

```html
<body>
  <div class="pref-section">
    Use custom youtube-dl/yt-dlp:
    <div style="margin-top: 2px">
      <input
        type="text"
        data-pref-key="ytdl_path"
        style="width: 100%; margin-top: 2px"
      />
    </div>
  </div>
  <div class="pref-section">
    <label>
      <input type="checkbox" data-type="bool" data-pref-key="use_manifest" />
      Use manifest URL
    </label>
    <p class="small secondary pref-help">
      Use the master manifest URL for formats like HLS and DASH, if available,
      allowing for video/audio selection in runtime.
    </p>
  </div>
</body>
```

### 12.3 Preferences API

IINA 提供 API 以键值对形式存储和读取偏好设置：

```javascript
const { preferences } = iina;
preferences.set("key", value);
preferences.get("key");
```

可在 `Info.json` 中声明默认值：

```json
{
  "preferenceDefaults": {
    "key": "value"
  }
}
```

### 12.4 绑定偏好设置值

IINA 为偏好设置页面提供数据绑定，大多数情况下只需在 `<input>` 元素上添加 `data-pref-key` 属性，值会自动与存储的偏好设置同步。

**数据类型规则：**

| 值类型 | HTML 元素 | data-type | 示例 |
|---|---|---|---|
| 布尔值 | `<input type="checkbox">` | `data-type="bool"` | 必须设置 |
| 数值（整数） | `<input type="number">` | `data-type="int"` | 必须设置 |
| 数值（浮点） | `<input type="number">` | `data-type="float"` | 必须设置 |
| 字符串 | `<input type="text">` | 可选 | 无需设置 |
| 单选按钮 | `<input type="radio">` | 不设 `data-pref-key` | 用 `name` 属性作为偏好键 |

> ⚠️ 单选按钮不使用 `data-pref-key`，而是将同一组所有单选按钮的 `name` 属性设为偏好键名。

**示例：**

```html
<input type="checkbox" data-type="bool" data-pref-key="foo" />
```

### 12.5 自定义绑定

如需更多控制，可使用 JavaScript API 手动绑定。偏好设置页面中可通过 `window.iina.preferences` 访问 `get` 和 `set` 方法：

```html
<script>
  const { preferences } = window.iina;
  const inputs = document.querySelectorAll("input[data-pref-key]");
  Array.prototype.forEach.call(inputs, (input) => {
    const key = input.dataset.prefKey;
    preferences.get(key, (value) => {
      input.value = value;
    });
    input.addEventListener("change", () => {
      let value = input.value;
      preferences.set(key, value);
    });
  });
</script>
```

---

## 十三、API 参考

全局 `iina` 对象包含以下模块：

| 模块 | 可用入口 | 说明 |
|---|---|---|
| `core` | Main | 播放器核心控制 |
| `mpv` | Main | mpv 底层 API 访问 |
| `event` | Main | 事件监听 |
| `http` | Main / Global | HTTP 请求 |
| `ws` | Main / Global | WebSocket 服务器 |
| `console` | Main / Global | 日志输出 |
| `menu` | Main / Global | 菜单管理 |
| `input` | Main | 键鼠输入捕获 |
| `overlay` | Main | 视频覆盖层 |
| `sidebar` | Main | 侧边栏视图 |
| `standaloneWindow` | Main / Global | 独立窗口 |
| `playlist` | Main | 播放列表管理 |
| `utils` | Main / Global | 工具方法 |
| `preferences` | Main / Global | 偏好设置 |
| `subtitle` | Main | 字幕提供者 |
| `file` | Main / Global | 文件系统 |
| `global` | Main / Global | 全局模块（跨播放器通信） |

### 13.1 Core 模块 (`iina.core`)

控制播放器的主要功能，包含子模块 `audio`、`video`、`subtitle`、`window`、`status`。

**主要方法：**

| 方法 | 说明 |
|---|---|
| `core.open(url)` | 在当前播放器窗口打开新文件 |
| `core.osd(message)` | 在窗口顶部显示 OSD 消息 |
| `core.pause()` | 暂停播放 |
| `core.resume()` | 恢复播放 |
| `core.stop()` | 停止播放并关闭文件 |
| `core.seek(seconds, exact)` | 前进/后退指定秒数，`exact` 为 false 时跳到最近关键帧 |
| `core.seekTo(seconds)` | 跳到指定位置 |
| `core.setSpeed(speed)` | 设置播放速度（1.0 正常，2.0 两倍速） |
| `core.getChapters()` | 返回章节列表 |
| `core.playChapter(index)` | 播放指定章节（从 0 开始） |
| `core.getHistory()` | 返回播放历史列表 |
| `core.getRecentDocuments()` | 返回最近打开文件列表 |
| `core.getVersion()` | 返回 IINA 和 mpv 版本信息 |

**core.status（播放状态，只读）：**

| 属性 | 类型 | 说明 |
|---|---|---|
| `paused` | boolean | 是否暂停 |
| `idle` | boolean | 是否空闲（无文件播放） |
| `position` | number \| null | 当前播放位置（秒） |
| `duration` | number \| null | 文件时长（秒） |
| `speed` | number | 播放速度 |
| `videoWidth` | number \| null | 视频宽度 |
| `videoHeight` | number \| null | 视频高度 |
| `isNetworkResource` | boolean | 是否为网络资源 |
| `url` | string | 当前文件 URL |
| `title` | string | 当前文件标题 |

**core.window（窗口控制）：**

| 属性/方法 | 类型 | 说明 |
|---|---|---|
| `loaded` | readonly boolean | 窗口是否已加载 |
| `visible` | readonly boolean | 窗口是否可见 |
| `screens` | readonly array | 所有屏幕信息 |
| `frame` | Rect | 获取/设置窗口位置和大小 |
| `fullscreen` | boolean | 获取/设置全屏状态 |
| `pip` | boolean | 获取/设置画中画状态 |
| `ontop` | boolean | 获取/设置置顶状态 |
| `miniaturized` | boolean | 获取/设置最小化状态 |
| `sidebar` | string \| null | 获取/设置侧边栏名称 |

**core.audio（音频控制）：**

| 属性 | 类型 | 说明 |
|---|---|---|
| `id` | number \| null | 当前音轨 ID（可设置以切换） |
| `tracks` | readonly Track[] | 所有音轨列表 |
| `currentTrack` | readonly Track | 当前音轨信息 |
| `delay` | number | 音频延迟（秒） |
| `volume` | number | 音量 |
| `muted` | boolean | 是否静音 |
| `loadTrack(url)` | method | 加载外部音轨 |

**core.video（视频控制）：**

| 属性 | 类型 | 说明 |
|---|---|---|
| `id` | number \| null | 当前视频轨 ID（可设置以切换） |
| `tracks` | readonly Track[] | 所有视频轨列表 |
| `currentTrack` | readonly Track | 当前视频轨信息 |
| `loadTrack(url)` | method | 加载外部视频轨 |

**core.subtitle（字幕控制）：**

| 属性 | 类型 | 说明 |
|---|---|---|
| `id` | number \| null | 当前字幕轨 ID（可设置以切换） |
| `secondID` | number \| null | 第二字幕轨 ID |
| `tracks` | readonly Track[] | 所有字幕轨列表 |
| `currentTrack` | readonly Track | 当前字幕轨信息 |
| `delay` | number | 字幕延迟（秒） |
| `loadTrack(url)` | method | 加载外部字幕 |

### 13.2 MPV 模块 (`iina.mpv`)

直接访问 mpv 的属性、命令和钩子。

| 方法 | 说明 |
|---|---|
| `mpv.getFlag(name)` | 获取属性为布尔值 |
| `mpv.getNumber(name)` | 获取属性为数值 |
| `mpv.getString(name)` | 获取属性为字符串 |
| `mpv.getNative<T>(name)` | 获取属性为原生 JS 对象（字典/列表） |
| `mpv.set(name, value)` | 设置属性值 |
| `mpv.command(name, args)` | 执行 mpv 命令 |
| `mpv.addHook(name, priority, callback)` | 添加 mpv 钩子 |

**addHook 注意事项：**
- 如果 callback 是 `async` 函数，**必须手动调用 `next()`**
- 如果是普通函数，忽略 `next()`，函数返回即视为完成

### 13.3 Event 模块 (`iina.event`)

监听 mpv 和 IINA 事件。事件名以 `iina.` 或 `mpv.` 为前缀。

| 方法 | 说明 |
|---|---|
| `event.on(eventName, callback)` | 注册事件监听，返回唯一 ID |
| `event.off(eventName, id)` | 移除事件监听 |

**IINA 事件列表：**

| 事件名 | 回调参数 | 说明 |
|---|---|---|
| `iina.window-loaded` | 无 | 窗口已加载 |
| `iina.window-size-adjusted` | frame: Rect | 窗口大小已调整 |
| `iina.window-moved` | frame: Rect | 窗口已移动 |
| `iina.window-resized` | frame: Rect | 窗口已缩放 |
| `iina.window-fs.changed` | status: boolean | 全屏状态变更 |
| `iina.window-screen.changed` | 无 | 窗口移到其他屏幕 |
| `iina.window-miniaturized` | 无 | 窗口最小化 |
| `iina.window-deminiaturized` | 无 | 窗口恢复 |
| `iina.window-main.changed` | status: boolean | 主窗口状态变更 |
| `iina.window-will-close` | 无 | 窗口即将关闭 |
| `iina.window-did-close` | 无 | 窗口已关闭 |
| `iina.music-mode.changed` | status: boolean | 音乐模式变更 |
| `iina.pip.changed` | status: boolean | 画中画状态变更 |
| `iina.file-loaded` | url: string | 新文件已加载 |
| `iina.file-started` | 无 | 新文件开始播放 |
| `iina.mpv-inititalized` | 无 | mpv 实例已初始化 |
| `iina.thumbnails-ready` | 无 | 缩略图已生成 |
| `iina.plugin-overlay-loaded` | 无 | 插件覆盖层已加载 |
| `mpv.{eventName}` | 无 | mpv 事件（加 `mpv.` 前缀） |
| `mpv.{property}.changed` | 无 | mpv 属性变更（加 `.changed` 后缀） |

### 13.4 Input 模块 (`iina.input`)

捕获播放器窗口的键盘和鼠标事件。

**常量：**

| 常量 | 说明 |
|---|---|
| `input.MOUSE` | 左键 |
| `input.RIGHT_MOUSE` | 右键 |
| `input.OTHER_MOUSE` | 其他键 |
| `input.PRIORITY_LOW` | 低优先级（默认） |
| `input.PRIORITY_HIGH` | 高优先级（在默认处理器前执行） |

**方法：**

| 方法 | 说明 |
|---|---|
| `input.normalizeKeyCode(code)` | 标准化 mpv 键码 |
| `input.getAllKeyBindings()` | 获取所有已注册的快捷键绑定 |
| `input.onKeyDown(button, callback, priority?)` | 监听按键按下 |
| `input.onKeyUp(button, callback, priority?)` | 监听按键释放 |
| `input.onMouseDown(button, callback, priority?)` | 监听鼠标按下 |
| `input.onMouseUp(button, callback, priority?)` | 监听鼠标释放 |
| `input.onMouseDrag(button, callback, priority?)` | 监听鼠标拖拽（仅左键） |

> ⚠️ 回调返回 `true` 会阻止事件传播（覆盖默认行为）。应避免使用 `PRIORITY_HIGH`，除非必要。

### 13.5 HTTP 模块 (`iina.http`)

| 方法 | 说明 |
|---|---|
| `http.get(url, options?)` | GET 请求 |
| `http.post(url, options?)` | POST 请求 |
| `http.put(url, options?)` | PUT 请求 |
| `http.patch(url, options?)` | PATCH 请求 |
| `http.delete(url, options?)` | DELETE 请求 |
| `http.xmlrpc(location)` | 创建 XML-RPC 客户端 |
| `http.download(url, dest, options?)` | 下载文件到本地 |

**HTTPRequestOption：**

| 字段 | 说明 |
|---|---|
| `params` | URL 参数或请求体参数 |
| `headers` | HTTP 请求头 |
| `data` | 请求体数据（主要用于 POST） |

**HTTPResponse：**

| 字段 | 说明 |
|---|---|
| `text` | 响应体文本 |
| `data` | 响应数据 |
| `statusCode` | HTTP 状态码 |
| `reason` | 状态原因（如 "ok"） |

**http.download() 的 dest 路径遵循插件文件路径约定（见 File 模块）。**

### 13.6 WebSocket 模块 (`iina.ws`)

创建本地 WebSocket 服务器，仅 macOS 10.15+ 可用，不支持 TLS。

| 方法 | 说明 |
|---|---|
| `ws.createServer(options)` | 创建服务器（`{port: number}`） |
| `ws.startServer()` | 启动服务器 |
| `ws.onStateUpdate(callback)` | 监听服务器状态变更 |
| `ws.onNewConnection(callback)` | 监听新连接 |
| `ws.onConnectionStateUpdate(callback)` | 监听连接状态变更 |
| `ws.onMessage(callback)` | 监听消息 |
| `ws.sendText(conn, text)` | 发送文本消息 |

**服务器状态：** `setup` | `ready` | `waiting` | `failed` | `cancelled`

### 13.7 Console 模块 (`iina.console`)

| 方法 | 说明 |
|---|---|
| `console.log(...message)` | debug 级别日志 |
| `console.warn(message)` | warning 级别日志 |
| `console.error(message)` | error 级别日志 |

### 13.8 Menu 模块 (`iina.menu`)

| 方法 | 说明 |
|---|---|
| `menu.item(title, action?, options?)` | 创建菜单项 |
| `menu.separator()` | 创建分隔符 |
| `menu.addItem(item)` | 添加菜单项到 Plugin 菜单 |
| `menu.items()` | 列出所有菜单项 |
| `menu.removeAt(index)` | 移除指定索引的菜单项 |
| `menu.removeAllItems()` | 移除所有菜单项 |
| `menu.forceUpdate()` | 刷新菜单 |

**menu.item() 的 options：**

| 选项 | 说明 |
|---|---|
| `enabled` | 是否启用，默认 true |
| `selected` | 是否选中（显示勾选标记），默认 false |
| `keyBinding` | 快捷键绑定（mpv 键码格式） |

**MenuItem 方法：**

| 方法 | 说明 |
|---|---|
| `item.addSubMenuItem(subItem)` | 添加子菜单项 |

> 💡 Global 入口创建的菜单始终可用；Main 入口创建的菜单仅在关联窗口获得焦点时可用。

### 13.9 Overlay 模块 (`iina.overlay`)

在视频上方渲染自定义内容。

| 方法 | 说明 |
|---|---|
| `overlay.show()` | 显示覆盖层 |
| `overlay.hide()` | 隐藏覆盖层 |
| `overlay.setOpacity(opacity)` | 设置透明度（0-1） |
| `overlay.setClickable(clickable)` | 启用/禁用交互 |
| `overlay.loadFile(path)` | 加载 HTML 文件 |
| `overlay.simpleMode()` | 启用简单模式 |
| `overlay.setStyle(style)` | 设置 CSS（简单模式） |
| `overlay.setContent(content)` | 设置 HTML 内容（简单模式） |
| `overlay.postMessage(name, data)` | 向覆盖层 WebView 发送消息 |
| `overlay.onMessage(name, callback)` | 接收来自覆盖层 WebView 的消息 |

### 13.10 Sidebar 模块 (`iina.sidebar`)

在侧边栏显示自定义内容。需在 Info.json 中配置 `sidebarTab`。

| 方法 | 说明 |
|---|---|
| `sidebar.show()` | 显示侧边栏并切换到插件标签页 |
| `sidebar.hide()` | 隐藏侧边栏 |
| `sidebar.loadFile(path)` | 加载 HTML 文件 |
| `sidebar.postMessage(name, data)` | 向侧边栏 WebView 发送消息 |
| `sidebar.onMessage(name, callback)` | 接收来自侧边栏 WebView 的消息 |

### 13.11 StandaloneWindow 模块 (`iina.standaloneWindow`)

创建独立窗口显示自定义内容。每个入口只能创建一个独立窗口。

| 方法 | 说明 |
|---|---|
| `standaloneWindow.open()` | 打开窗口 |
| `standaloneWindow.close()` | 关闭窗口 |
| `standaloneWindow.loadFile(path)` | 加载 HTML 文件 |
| `standaloneWindow.simpleMode()` | 启用简单模式 |
| `standaloneWindow.setStyle(style)` | 设置 CSS（简单模式） |
| `standaloneWindow.setContent(content)` | 设置 HTML 内容（简单模式） |
| `standaloneWindow.setProperty(props)` | 设置窗口属性 |
| `standaloneWindow.setFrame(w?, h?, x?, y?)` | 设置窗口大小和位置 |
| `standaloneWindow.postMessage(name, data)` | 向窗口 WebView 发送消息 |
| `standaloneWindow.onMessage(name, callback)` | 接收来自窗口 WebView 的消息 |

**setProperty() 的 props：**

| 属性 | 说明 |
|---|---|
| `title` | 窗口标题 |
| `resizable` | 是否可缩放 |
| `hudWindow` | 是否为 HUD 窗口（半透明毛玻璃效果） |
| `fullSizeContentView` | 内容视图是否延伸到标题栏 |
| `hideTitleBar` | 是否隐藏标题栏 |

### 13.12 Playlist 模块 (`iina.playlist`)

| 方法 | 说明 |
|---|---|
| `playlist.list()` | 获取播放列表所有项 |
| `playlist.count()` | 获取播放列表项数 |
| `playlist.add(url, at?)` | 添加项（可指定插入位置） |
| `playlist.remove(index)` | 移除指定项 |
| `playlist.move(index, to)` | 移动项 |
| `playlist.play(index)` | 播放指定项 |
| `playlist.playNext()` | 播放下一个 |
| `playlist.playPrevious()` | 播放上一个 |
| `playlist.registerMenuBuilder(builder)` | 注册播放列表右键菜单构建器 |

### 13.13 Utils 模块 (`iina.utils`)

| 方法 | 说明 |
|---|---|
| `utils.fileInPath(file)` | 检查可执行文件是否在 PATH 中或路径是否存在 |
| `utils.resolvePath(path)` | 解析路径（展开 `@data` 等特殊前缀和 `~`） |
| `utils.exec(file, args, cwd?, stdoutHook?, stderrHook?)` | 执行外部程序 |
| `utils.ask(title)` | 显示确认对话框，返回 boolean |
| `utils.prompt(title)` | 显示输入对话框，返回 string 或 undefined |
| `utils.chooseFile(title, options?)` | 显示文件选择器，返回路径 |
| `utils.keyChainWrite(service, name, password)` | 写入钥匙串 |
| `utils.keyChainRead(service, name)` | 读取钥匙串 |
| `utils.open(url)` | 在系统中打开 URL 或在 Finder 中显示文件 |

**utils.exec() 错误码：**

| 常量 | 值 | 说明 |
|---|---|---|
| `ERROR_BINARY_NOT_FOUND` | -1 | 可执行文件未找到 |
| `ERROR_RUNTIME` | -2 | 可执行文件无法运行 |

**utils.chooseFile() 的 options：**

| 选项 | 说明 |
|---|---|
| `chooseDir` | 选择目录而非文件 |
| `allowedFileTypes` | 可选文件扩展名列表 |

### 13.14 Preferences 模块 (`iina.preferences`)

| 方法 | 说明 |
|---|---|
| `preferences.get(key)` | 获取偏好值 |
| `preferences.set(key, value)` | 设置偏好值 |
| `preferences.sync()` | 持久化偏好到磁盘 |

> 💡 默认情况下偏好仅在设置页面关闭时持久化，程序中调用 `set` 后建议手动调用 `sync()`。

### 13.15 Subtitle 模块 (`iina.subtitle`)

| 方法/常量 | 说明 |
|---|---|
| `subtitle.CUSTOM_IMPLEMENTATION` | 自定义实现标记（search 返回此值跳过内置 UI） |
| `subtitle.item(data, desc?)` | 创建 SubtitleItem |
| `subtitle.registerProvider(id, provider)` | 注册字幕提供者 |

### 13.16 File 模块 (`iina.file`)

**特殊路径前缀（伪目录）：**

| 前缀 | 说明 |
|---|---|
| `@tmp/` | 插件临时目录（IINA 退出后可能清理） |
| `@data/` | 插件数据目录 |
| `@video/:id` | 当前视频轨文件 |
| `@audio/:id` | 当前音轨文件 |
| `@sub/:id` | 当前字幕轨文件 |

| 方法 | 说明 |
|---|---|
| `file.list(path, options?)` | 列出目录内容 |
| `file.exists(path)` | 检查文件/目录是否存在 |
| `file.write(path, content)` | 写入文本文件 |
| `file.read(path, options?)` | 读取文本文件 |
| `file.trash(path)` | 移到废纸篓 |
| `file.delete(path)` | 立即删除文件 |
| `file.showInFinder(path)` | 在 Finder 中显示 |
| `file.handle(path, mode)` | 获取二进制文件句柄（`read`/`write`） |

**FileHandle 方法：**

| 方法 | 说明 |
|---|---|
| `handle.offset()` | 获取当前偏移量 |
| `handle.seekTo(offset)` | 跳到指定偏移量 |
| `handle.seekToEnd()` | 跳到文件末尾 |
| `handle.read(length)` | 读取指定字节数 |
| `handle.readToEnd()` | 读取到文件末尾 |
| `handle.write(data)` | 写入数据 |
| `handle.close()` | 关闭文件句柄 |

### 13.17 Global 模块 (`iina.global`)

跨播放器通信和创建播放器实例。

| 方法 | 说明 | 可用入口 |
|---|---|---|
| `global.createPlayerInstance(options)` | 创建新的托管播放器 | Global only |
| `global.getLabel()` | 获取当前播放器的自定义标签 | Main only |
| `global.postMessage(target, name, data)` | 向播放器发送消息 | Global only |
| `global.postMessage(name, data)` | 向全局入口发送消息 | Main only |
| `global.onMessage(name, callback)` | 注册消息监听 | Both |

**createPlayerInstance() 的 options：**

| 选项 | 说明 |
|---|---|
| `disableWindowAnimation` | 禁用窗口动画 |
| `disableUI` | 隐藏窗口 UI |
| `enablePlugins` | 启用所有插件（默认仅加载当前插件） |
| `label` | 自定义标签 |
| `url` | 要打开的 URL |

**postMessage 的 target 参数（Global 端）：**

| 值 | 说明 |
|---|---|
| `null` | 发送给所有播放器 |
| `number` | createPlayerInstance 返回的 ID |
| `string` | 播放器的 label |

---

## 十四、数据类型

### Track（轨道信息）

| 属性 | 类型 | 说明 |
|---|---|---|
| `id` | number | 轨道 ID |
| `title` | string \| null | 轨道标题 |
| `formattedTitle` | string | 格式化后的标题（保证非 null） |
| `lang` | string \| null | 语言 |
| `codec` | string \| null | 编解码器 |
| `isDefault` | boolean | 是否为默认 |
| `isForced` | boolean | 是否强制 |
| `isSelected` | boolean | 是否选中 |
| `isExternal` | boolean | 是否外部 |
| `demuxW` | number \| null | 视频宽度 |
| `demuxH` | number \| null | 视频高度 |
| `demuxChannelCount` | number \| null | 音频通道数 |
| `demuxSamplerate` | number \| null | 采样率 |
| `demuxFPS` | number \| null | 帧率 |

### Chapter（章节）

| 属性 | 类型 | 说明 |
|---|---|---|
| `title` | string | 章节标题 |
| `start` | number | 起始时间（秒） |

### PlaylistItem（播放列表项）

| 属性 | 类型 | 说明 |
|---|---|---|
| `filename` | string | 文件路径或 URL |
| `title` | string \| null | 标题（M3U 等来源） |
| `isPlaying` | boolean | 是否正在播放 |
| `isCurrent` | boolean | 是否为当前项 |

### Rect（矩形）

| 属性 | 类型 | 说明 |
|---|---|---|
| `x` | number | X 坐标 |
| `y` | number | Y 坐标 |
| `width` | number | 宽度 |
| `height` | number | 高度 |

### History（播放历史）

| 属性 | 类型 | 说明 |
|---|---|---|
| `name` | string | 文件名 |
| `url` | string | 文件 URL |
| `date` | Date | 播放日期 |
| `progress` | number \| null | 上次播放进度（秒） |
| `duration` | number | 文件时长（秒） |
