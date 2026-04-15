# Niconicomments 解析文档

## Nicoscript 命令格式

Nicoscript 命令格式：`@コマンド名 [参数]`

- 全角 `@` 字符：`\uff20`（不是半角 `@`）
- 正则：`/^[@\uff20](\S+)(?:\s(.+))?/`

---

## 基本弹幕类型

### 弹幕模式（mode）

| mode | 类型 | 说明 |
|------|------|------|
| 1 | 滚动弹幕 | 从右向左滚动 |
| 2 | 固定弹幕 | 固定位置（较少用） |
| 4 | 底部固定 | 底部居中显示 |
| 5 | 顶部固定 | 顶部居中显示 |

### mail 命令到 mode 的转换

```
mail 包含 "shita" → mode 4（底部）
mail 包含 "ue"   → mode 5（顶部）
其他             → mode 1（滚动）
```

---

## 已实现命令

### 1. 倒放 (`@逆`)

**状态**：✅ 已实现

**正则**：
```javascript
const RE_REVERSE = /^@\u9006(?:\s+)?(\u5168|\u30b3\u30e1|\u6295\u30b3\u30e1)?/;
// \u9006 = 逆
// \u5168 = 全
// \u30b3\u30e1 = コメ
// \u6295\u30b3\u30e1 = 投コマ
```

**参数**：
- 目标类型（可选）：`全`、`コメ`、`投コマ`，默认 `全`
- 持续时间：`@数字` 指定秒数，默认 30 秒

**示例**：
```
@逆 @35        // 全量倒放，35秒
@逆 コメ @60   // 只评论弹幕倒放，60秒
```

**状态存储**：
```javascript
const nicoScripts = {
  reverse: []  // { start, end, target }
};
```

**判断逻辑**：`isReverseActive(vposSec, isOwner)`

**CSS 实现**：
```javascript
// 正放：--end-x = -100%（向左）
// 倒放：--end-x = 100vw（向右）
if (isReverse) {
  el.style.setProperty('--start-x', `100vw`);
  el.style.setProperty('--end-x', `-100%`);
} else {
  el.style.setProperty('--start-x', `100vw`);
  el.style.setProperty('--end-x', `-100%`);
}
```

**镜像反转实现**（全屏反转）：
```javascript
function reverseAllActiveDanmaku(newReverseState) {
  const winW = window.innerWidth;
  activeDanmaku.forEach(item => {
    const el = item.el;
    const d = item.d;
    const durMs = (d.m >= 1 && d.m <= 3) ? scrollDuration : fixedDuration;
    const currentSpeedMult = getSpeedMultiplier(lastTime, d._isOwner);
    const adjustedDurMs = durMs / currentSpeedMult;
    const elapsedMs = (lastTime - d.t) * 1000;
    const remainingMs = adjustedDurMs - elapsedMs;

    const rect = el.getBoundingClientRect();
    const currentX = rect.left;
    const elW = rect.width;

    el.style.animation = 'none';
    el.offsetHeight;

    if (newReverseState) {
      const mirroredX = winW - currentX;
      el.style.setProperty('--start-x', `${mirroredX}px`);
      el.style.setProperty('--end-x', `${winW + elW}px`);
    } else {
      const mirroredX = winW - currentX;
      el.style.setProperty('--start-x', `${mirroredX}px`);
      el.style.setProperty('--end-x', `${-elW}px`);
    }

    el.style.setProperty('--dur', `${remainingMs}ms`);
    el.style.setProperty('--delay', `0ms`);
    el.style.animation = '';
  });
  resetLaneData();
}
```

**测试用 JSON 格式**：
```json
[
  {
    "fork": "owner",
    "comments": [
      { "vposMs": 624380, "body": "@逆　全", "commands": ["@35"] }
    ]
  },
  {
    "fork": "comment",
    "comments": []
  }
]
```

**测试用 XML 格式**：
```xml
<chat vpos="6240" mail="@35">@逆　全</chat>
```

---

### 2. 速度控制 (`@速い` / `@遅い`)

**状态**：✅ 已实现

**正则**：
```javascript
const RE_SPEED_UP = /^@\u901f\u3044/;    // @速い - 2倍速
const RE_SPEED_DOWN = /^@\u9045\u3044/;  // @遅い - 0.5倍速
```

**参数**：
- 持续时间：`@数字` 指定秒数，默认 30 秒

**示例**：
```
@速い @20      // 20秒内加速2倍
@遅い @15      // 15秒内减速0.5倍
```

**状态存储**：
```javascript
const nicoScripts = {
  speed: []  // { start, end, multiplier: 2 | 0.5 }
};
```

**应用方式**：
```javascript
const speedMult = getSpeedMultiplier(d.t, d._isOwner);
const adjustedDurMs = durMs / speedMult;  // 速度越快，时长越短
```

**实现代码**：
```javascript
function processSpeedScript(vposSec, content, commands) {
  const speedUpMatch = RE_SPEED_UP.exec(content);
  const speedDownMatch = RE_SPEED_DOWN.exec(content);
  if (!speedUpMatch && !speedDownMatch) return;

  const isSpeedUp = !!speedUpMatch;
  let durationSec = 30;

  for (const cmd of commands) {
    const durationMatch = /^@(\d+)$/.exec(cmd);
    if (durationMatch) {
      durationSec = parseInt(durationMatch[1], 10);
      break;
    }
  }

  nicoScripts.speed.unshift({
    start: vposSec,
    end: vposSec + durationSec,
    multiplier: isSpeedUp ? 2 : 0.5
  });
  speedActiveOwnerCache.clear();
  speedActiveViewerCache.clear();
}

function getSpeedMultiplier(vposSec, isOwner) {
  const cache = isOwner ? speedActiveOwnerCache : speedActiveViewerCache;
  const cached = cache.get(vposSec);
  if (cached !== undefined) return cached;

  let multiplier = 1;
  for (const range of nicoScripts.speed) {
    if (range.start <= vposSec && vposSec <= range.end) {
      multiplier = range.multiplier;
      break;
    }
  }

  cache.set(vposSec, multiplier);
  return multiplier;
}
```

**测试用 JSON 格式**：
```json
[
  {
    "fork": "owner",
    "comments": [
      { "vposMs": 4000, "body": "@速い @10 加速コマンド", "commands": ["@10"] },
      { "vposMs": 8000, "body": "@遅い @10 減速コマンド", "commands": ["@10"] }
    ]
  }
]
```

**测试用 XML 格式**：
```xml
<chat vpos="40" mail="@10">@速い 加速コマンド</chat>
<chat vpos="80" mail="@10">@遅い 減速コマンド</chat>
```

---

## 未实现命令

### 命令列表

| 命令 | 说明 | 示例 |
|------|------|------|
| `@ボタン` | 按钮控件 | `@ボタン click me` |
| `@デフォルト` | 重置样式 | - |
| `@コメント禁止` | 禁言（停止弹幕显示） | - |
| `@シーク禁止` | 禁止跳转 | - |
| `@ジャンプ` | 跳转时间 | `@ジャンプ 1000` |
| `@置換` | 内容替换 | - |

---

## Flash 弹幕（ASCII Art）

### 识别条件
弹幕同时满足以下条件时被视为 Flash 弹幕：
1. 包含制表符 `\t` 或特定 Unicode 字符
2. 使用特殊 mail 命令如 `full`、`mincho`、`patissier`

### 特殊字符

| 字符 | Unicode | 用途 |
|------|---------|------|
| 全角空格 | `\u3000` | 定位、间距 |
| `\u2000` | `\u2000` | 全角空格变体 |
| `\u2001` | - | 宽间距 |
| `\u2004` | - | 1/4 宽间距 |
| `\t` | 制表符 | 绘制线条 |
| `￣` | `\uff5e` | 破折号 |
| `─` | `\u2500` | 水平线 |
| `━` | `\u2501` | 粗水平线 |

### 字体分类

| mail 命令 | 字体名 | 说明 |
|-----------|--------|------|
| `mincho` | simsun | 明朝体 |
| `gothic` | defont | 黑体 |
| `gulim` | gulim | 韩文字体 |
| `patissier` | - | 特殊字体 |

### 字体变化字符

通过特定 Unicode 字符切换字体：

```typescript
flashChar: {
  gulim: "[\u0126-\uff9f各种韩文...]",
  simsunStrong: "[\u01ce\u01d0...各种强字体字符...]",
  simsunWeak: "[\u02c9\u2105...各种弱字体字符...]",
  gothic: "[\u03fb\uff9f\u30fb]"
}
```

### Flash 模式

```typescript
flashMode: "vista"  // 或 "xp"
// vista: 限制为 1-2 种字体
// xp: 所有字体变化字符都适用
```

### 兼容空格宽度 (`compatSpacer`)

```typescript
compatSpacer: {
  flash: {
    "\u3000": { simsun: 0.98, defont: 0.645, gulim: 0.95 },
    "\u00a0": { simsun: 0.25 },
    "\u0020": { defont: 0.3 },
    "\u2001": { defont: 0.95 },
    "\u2004": { defont: 1.6 },
    "\u2007": { defont: 1.6 },
    "\u202a": { defont: 0.59 }
  }
}
```

### 解析流程

1. `parseContent()` - 解析整个弹幕内容
2. `parseLine()` - 按行解析
3. `parseFullWidthPart()` - 解析全角字符
4. `getFlashFontIndex()` - 获取字体变化字符的索引
5. `parseMultiFontFullWidthPart()` - 处理多字体混合

### 半角/全角区分

```typescript
// 匹配半角字符（包括日语半角）
/[ -~｡-ﾟ]+/g

// 匹配非半角字符（全角）
/[^ -~｡-ﾟ]+/g
```

---

## 按钮 (`@ボタン`)

### 按钮弹幕格式
```
@ボタン 点击显示的文字
```

### 按钮部件
- `left` - 左边框
- `middle` - 中间部分
- `right` - 右边框

### 按钮样式计算
```typescript
const atButtonPadding = 5;  // 可配置
const lineHeight = fontSize * lineHeight;
```

---

## 示例弹幕分析

### 职人弹幕（普通滚动）
```
vposMs=0, body="職人が来たら静かにするのがマナー"
commands=["shita", "red", "big", "184"]
```

### Flash 弹幕（ASCII Art）
```
vposMs=28390
body="\u2000\n\n\n\u2000\n\n￣￣￣￣￣￣￣￣\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\u2001\n\n\n\u2000\n\n\n\u2000"
commands=["13", "n aka", "ender", "full", "#ffffff", "mincho", "patissier"]
```

### 解析结果
- 换行符 `\n` 分隔多行
- `\u2000` 全角空格用于定位
- `\t` 制表符绘制水平线
- `full` 命令全屏显示
- `mincho` 使用明朝字体
- `ender` 标记结束

---

## 配置参考

### Line Height
```typescript
lineHeight: {
  small: { default: 18/15, resized: 10/7.5 },
  medium: { default: 29/25, resized: 15/12 },
  big: { default: 45/39, resized: 24/19.5 }
}
```

### Flash Comment Y Padding
```typescript
flashCommentYPaddingTop: {
  default: 5,
  resized: 3
}
```

### Flash Comment Y Offset
```typescript
flashCommentYOffset: {
  small: { default: -0.2, resized: -0.2 },
  medium: { default: -0.2, resized: -0.2 },
  big: { default: -0.2, resized: -0.2 }
}
```

### Flash Line Break Scale
```typescript
flashLineBreakScale: {
  small: 0.557,
  medium: 0.519,
  big: 0.535
}
```

---

## CSS 引擎移植优先级

### 已完成
1. ✅ `@逆` 倒放
2. ✅ `@速い/@遅い` 速度

### 中优先级
3. `@デフォルト` 重置样式
4. `@コメント禁止` 禁言

### 低优先级（需要按钮交互）
5. `@ボタン` 按钮控件
6. `@ジャンプ` 跳转

### 移植难点
1. Flash 弹幕需要精确的字符宽度计算
2. 多行 ASCII Art 需要正确的行高和定位
3. 各种特殊空格 `\u2000-\u2007` 的宽度不一致
4. 字体切换字符的识别和应用
