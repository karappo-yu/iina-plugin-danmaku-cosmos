项目：niconicomments (v0.2.78)
源码路径：/Users/mujica/Documents/project/niconicomments
插件集成路径：/Users/mujica/Documents/project/iina-plugin-danmaku-cosmos
授权：可以直接改 niconicomments 源码（已 fork），在现有 canvas 渲染基础上做增强，不要破坏 canvas 模式。

---

## 目标

给 niconicomments 库增加一个 **CSS DOM 渲染模式**，和现有 Canvas 渲染并存。用户通过 `mode: "css"` 选项切换。CSS 模式利用 Safari 的 GPU 合成加速（transform + will-change），解决 canvas 在 WKWebView 下性能差的问题。Canvas 模式保持原样不动。

## 背景

这个库目前只有 CanvasRenderer，所有弹幕通过 canvas 2D context 的 fillText/strokeText 绘制。在 IINA（macOS）的 WKWebView 环境下，canvas 渲染性能很差（Safari 的 canvas 2D 没有 GPU 加速）。而 CSS DOM 渲染（position:absolute + transform）在 WebKit 下有 GPU 合成层加速，流畅度高很多。

## 架构要点

### 库的渲染流程（main.ts）

```
drawCanvas(vpos)
  → 遍历 timeline[vpos] 取出当前可见的 comment
  → 每个 comment 已有计算好的 posX/posY/layer 等位置信息
  → renderer.fillText() / renderer.strokeText() / renderer.drawImage() 绘制
```

核心文件：
- `src/main.ts` — NiconiComments 类，drawCanvas 方法
- `src/utils/comment.ts` — 弹幕位置计算（processMovableComment / processFixedComment）
- `src/@types/IComment.ts` — IComment 接口（包含 posX, posY, width, height, layer, text 等）
- `src/@types/renderer.ts` — IRenderer 接口
- `src/renderer/canvas.ts` — 现有的 CanvasRenderer 实现

### 改造方案

在 NiconiComments 构造函数新增选项 `mode: "css"`。当 mode="css" 时，不创建 CanvasRenderer，而是创建一个 CSSRenderer。

#### CSSRenderer 思路

不是实现 IRenderer 接口（那是个 canvas 2D context 抽象，跟 DOM 不匹配），而是在 drawCanvas 的绘制阶段做分支：

```
drawCanvas(vpos)
  → 原有碰撞/位置计算不变
  → 到绘制阶段时判断 mode：
    mode="default"|"html5"|"flash"：renderer.fillText/strokeText（现有逻辑，不动）
    mode="css"：绘制到 DOM 元素
```

#### DOM 元素管理

- 弹幕容器：一个 absolute 定位的 div，铺满视口，pointer-events: none
- 每个 IComment 渲染为一个 div.dm-comment
- 使用对象池管理 DOM 元素（避免频繁 createElement/removeChild 触发 GC）

#### 坐标映射

库内部用 1920×1080 参考坐标系，所有位置计算基于 px：
- `config.canvasWidth = 1920`
- `config.canvasHeight = 1080`
- `comment.posX` 范围 0~1920
- `comment.posY` 范围 0~1080

CSS 需要转成 vh/vw：
```
left: (posX / 1920 * 100)vw
top: (posY / 1080 * 100)vh
font-size: 根据库计算的实际 px 转 vh
```

#### GPU 加速要点

- 所有弹幕 `position: absolute; will-change: transform; contain: layout style paint`
- 滚动弹幕用 CSS `@keyframes` + `transform: translateX()`，避免 JS 逐帧更新
- 固定弹幕用 `animation: fade-out` 控制生命周期
- transform 和 opacity 的动画会触发 GPU 合成层

#### 需要处理的关键问题

1. **滚动弹幕**：库的 processMovableComment 计算了弹幕在每个 vpos 的 leftPos。CSS 需要转换为 from→to 两个位置的 translateX 动画。from: `100vw`（屏幕右边缘），to: `-100%`（弹幕自身宽度左边缘）。时间是 comment.long 决定的

2. **固定弹幕（顶部/底部）**：显示在固定位置 comment.long 毫秒后淡出。CSS animation 控制 opacity

3. **定位弹幕（mode=7）**：absolute 定位不打动画，固定时长后消失

4. **描边**：WebKit 支持 `-webkit-text-stroke`，效果同 canvas strokeText

5. **@逆（@\u9006）弹幕**：反向滚动，CSS animation reverse

6. **@\u30b5\u30a4\u30ba/\u7e26/\u6a2a 等 nicoscript 命令**：库内部已处理，CSSRenderer 只需按最终 posX/posY 渲染

7. **z-index / layer**：CA 分离后的 layer 值映射为 CSS z-index

8. **生命周期**：drawCanvas 每帧产出的可见 comment 列表 vs 上一帧的列表 → diff → 新增的创建 DOM、离开的回收

9. **透明度**：comment.opacity 或 this.alpha 映射为 CSS opacity

### 不改的地方

- 数据解析（inputParser.ts）—— 不动
- 碰撞检测和位置计算（comment.ts）—— 不动  
- 时间线管理（timeline）—— 不动
- Canvas 模式的所有逻辑 —— 不动
- Nicoscript 处理 —— 不动
- CA 层分离 —— 不动

### 参考文件

- `/Users/mujica/Documents/project/niconicomments/src/main.ts` — drawCanvas 方法、constructor
- `/Users/mujica/Documents/project/niconicomments/src/@types/IComment.ts` — 弹幕数据结构
- `/Users/mujica/Documents/project/niconicomments/src/renderer/canvas.ts` — 现有 CanvasRenderer
