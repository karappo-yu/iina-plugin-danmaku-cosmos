# IINA 插件开发速查

## 架构要点

- **Main Entry** (`entry`): 每个播放器一个实例，可控制该播放器，`iina.window-loaded` 后才能用 overlay/OSD
- **Global Entry** (`globalEntry`): IINA 启动时执行，仅一个实例，不能直接用 `core`/`mpv`，可用 `global` 模块创建播放器和通信
- **执行时序**: Player创建 → 插件代码执行 → 用户打开文件 → 文件播放
- **运行时操作必须用事件监听**，如 `mpv.file-loaded`、`iina.window-loaded`

## WebView 通信

- WebView 是独立进程，**不能直接调用 IINA API**
- 插件→WebView: `overlay.postMessage(name, data)` / `sidebar.postMessage` / `standaloneWindow.postMessage`
- WebView→插件: `iina.postMessage(name, data)` + 插件端 `overlay.onMessage(name, cb)`
- 多 WebView 间通信需经插件脚本转发
- data 必须是 **JSON 可序列化**（不能有 Date/RegExp/Map/Set/Function/Symbol/BigInt/ArrayBuffer/循环引用）

## Overlay 交互

- 默认不可交互，需 `overlay.setClickable(true)` 开启
- 可点击元素必须加 `data-clickable` 属性
- 输入框获焦后捕获所有键盘事件，需手动 blur 或按钮提交
- 用完调用 `overlay.setClickable(false)`

## 浅色/深色

- 用 CSS 变量 + `@media (prefers-color-scheme: dark)` 适配
- WebView 背景透明，自动跟随系统外观

## 模块可用性

| 模块 | Main | Global |
|---|---|---|
| core, mpv, event, input, overlay, sidebar, playlist, subtitle | ✅ | ❌ |
| http, ws, console, menu, standaloneWindow, utils, preferences, file | ✅ | ✅ |
| global (createPlayerInstance) | ❌ | ✅ |
| global (postMessage/onMessage/getLabel) | ✅ | ✅ |

## 关键 API 速查

```
core: open, osd, pause, resume, stop, seek, seekTo, setSpeed, getChapters, playChapter
core.status: paused, idle, position, duration, speed, url, title, isNetworkResource
core.window: frame, fullscreen, pip, ontop, miniaturized, sidebar
core.audio: id, tracks, volume, muted, delay, loadTrack
core.subtitle: id, secondID, tracks, delay, loadTrack
mpv: getFlag, getNumber, getString, getNative, set, command, addHook
event: on(返回ID), off(用ID移除)
  IINA事件: iina.window-loaded, iina.file-loaded, iina.plugin-overlay-loaded...
  MPV事件: mpv.{event}, mpv.{property}.changed
input: onKeyDown, onKeyUp, onMouseDown, onMouseUp, onMouseDrag
  常量: MOUSE, RIGHT_MOUSE, PRIORITY_LOW, PRIORITY_HIGH
  回调返回true阻止传播
http: get, post, put, patch, delete, xmlrpc, download(url, dest)
ws: createServer, startServer, onStateUpdate, onMessage, sendText (仅10.15+)
menu: item(title, action?, {enabled, selected, keyBinding}), addItem, separator
overlay: show, hide, setOpacity, setClickable, loadFile, simpleMode, setStyle, setContent
sidebar: show, hide, loadFile, postMessage, onMessage
standaloneWindow: open, close, loadFile, simpleMode, setStyle, setContent, setProperty, setFrame
playlist: list, count, add, remove, move, play, playNext, playPrevious, registerMenuBuilder
utils: fileInPath, resolvePath, exec, ask, prompt, chooseFile, keyChainWrite/Read, open
preferences: get, set, sync(程序set后建议手动sync)
subtitle: CUSTOM_IMPLEMENTATION, item(data), registerProvider(id, {search, description, download})
file: list, exists, write, read, trash, delete, showInFinder, handle(二进制)
  伪目录: @tmp/, @data/, @video/:id, @audio/:id, @sub/:id
global: createPlayerInstance({url, disableUI, ...}), postMessage(target/null, name, data), onMessage
```

## 字幕提供者

- Info.json 声明 `subtitleProviders: [{id, name}]`
- 主入口直接调用 `subtitle.registerProvider(id, {search, description, download})`
- search 返回 `SubtitleItem[]` 或 `subtitle.CUSTOM_IMPLEMENTATION`
- download 返回文件路径数组，推荐下载到 `@tmp/`

## 偏好设置

- Info.json: `preferencesPage`, `preferenceDefaults`
- 自动绑定: `<input data-pref-key="key" data-type="bool|int|float">`
- radio 用 `name` 属性作 key，不用 `data-pref-key`
- WebView 中用 `window.iina.preferences.get/set`

## JS 兼容性

- 基线 ES6（对应 Safari 9 / macOS 10.11）
- 无 `window`/`fetch`/`prompt`/`localStorage`，用 IINA 替代 API
- `setTimeout`/`setInterval`/`clearTimeout`/`clearInterval` 可直接用
- IINA 模块系统: `require()` + `module.exports`，推荐用 Parcel 打包

## 调试

- 符号链接开发: `ln -s /path/plugin ~/Library/Application\ Support/com.colliderli.iina/plugins/name.iinaplugin-dev`
- 日志: Window > Log Viewer，子系统名 `global - <name>` 或 `player<id> - <name>`
- JS控制台(1.4.0+): Plugin > Developer Tool
- Safari Web Inspector: 开发菜单 > 电脑名 > 选JS上下文

## 权限

| 权限 | 对应API |
|---|---|
| show-osd | core.osd() |
| show-alert | utils.ask/prompt |
| video-overlay | overlay模块 |
| network-request | http模块 |
| file-system | file模块, utils.exec() |
