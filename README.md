# Danmaku Cosmos

[日本語](#日本語) / [中文](#中文) / [English](#english)

IINA 弹幕插件，基于 [niconicomments](https://github.com/xpadev-net/niconicomments)（已 fork 增强）。这是一款完全 niconico 风格的弹幕插件，专注于 Niconico 格式（XML / V1 JSON）的渲染，同时提供 Bilibili XML 的基础支持。CSS 和 Canvas 双渲染模式。

> **注意**：本插件以 niconico 弹幕风格为核心设计，对 Bilibili 等中文弹幕格式的支持有限。中文弹幕将以 niconico 风格渲染，不支持 Bilibili 特有的高级弹幕（mode 7）、代码弹幕（mode 8）、BAS 弹幕（mode 9）等功能。

---

## 中文

### 安装

1. 安装 [IINA](https://iina.io/)（如尚未安装）
2. 从 [Releases](https://github.com/karappo-yu/iina-plugin-danmaku-cosmos/releases) 下载 `.iinaplgz` 文件
3. 打开 IINA → 设置 → 插件 → 添加插件，选择下载的 `.iinaplgz` 文件
4. 重启 IINA

### 功能特性

- **Niconico 格式完整支持**：Niconico XML、Niconico V1 JSON
- **Bilibili XML 基础支持**：普通滚动弹幕、顶部/底部固定弹幕（以 niconico 风格渲染）
- **双渲染模式**：
  - **CSS 模式**：利用 WebKit GPU 合成加速（`transform` + `will-change`），在 IINA 的 WKWebView 环境下流畅度远超 Canvas
  - **Canvas 模式**：基于魔改 niconicomments（已 fork 增加 CSS 渲染器），支持 Auto / HTML5 / Flash 三种模式
- **自动加载弹幕**：按优先级自动查找同目录下的弹幕文件
- **手动加载弹幕**：通过菜单或侧边栏手动选择弹幕文件
- **侧边栏控制面板**：实时调整透明度、字体缩放、渲染模式

### 渲染模式说明

| 模式 | 说明 | 推荐场景 |
|------|------|----------|
| **CSS** | DOM 元素 + CSS 动画，WebKit GPU 加速 | IINA 播放（推荐） |
| **Auto** | 自动判断 HTML5 / Flash 弹幕 | 通用 |
| **HTML5** | 所有弹幕按 HTML5 模式渲染 | — |
| **Flash** | 所有弹幕按 Flash 模式渲染 | — |

Auto、HTML5、Flash 均为 Canvas 渲染，使用 niconicomments 库的渲染方式。CSS 模式在侧边栏的「渲染模式」下拉框中选择。

### 弹幕文件加载

#### 自动加载

插件会按以下优先级自动查找同目录下的弹幕文件：

1. **同名 JSON**：`video.mkv` → `video.json`
2. **同名 XML**：`video.mkv` → `video.xml`
3. **弹幕文件夹/同名**：`video.mkv` → `弹幕/video.xml`（支持 `弹幕` / `Comments` / `コメント` 三种文件夹名）
4. **弹幕文件夹/集数**：`video.mkv` → `弹幕/3.xml`（从文件名中自动提取集数）

#### 手动加载

- **侧边栏**：点击「添加」按钮选择弹幕文件
- **菜单栏**：插件 → Danmaku → 手动加载弹幕文件…
- 支持同时加载多个文件，自动去重合并

### 注意事项

- 本插件以 niconico 弹幕风格为核心，Bilibili 等中文弹幕将以 niconico 风格渲染，不支持 Bilibili 高级弹幕、代码弹幕、BAS 弹幕等特有功能
- CSS 模式下字符画（コメントアート）的垂直位置可能与 Canvas 模式略有差异
- Canvas 模式下字符画在 IINA 的 WebKit 渲染中可能出现错位（Safari canvas 2D 无 GPU 加速）
- 文件名包含特殊字符（如 `[`、`]`）可能导致自动加载失败
- 最小化窗口后再恢复，弹幕会重新渲染（已知限制）

---

## 日本語

> **注意**：本プラグインは niconico コメントスタイルを中心に設計されており、Bilibili など中国語コメントフォーマットのサポートは限定的です。中国語コメントは niconico スタイルで描画され、Bilibili 固有の高度なコメント（mode 7）、スクリプトコメント（mode 8）、BAS コメント（mode 9）などには対応していません。

### インストール

1. [IINA](https://iina.io/) をインストール（未インストールの場合）
2. [Releases](https://github.com/karappo-yu/iina-plugin-danmaku-cosmos/releases) から `.iinaplgz` ファイルをダウンロード
3. IINA → 設定 → プラグイン → プラグインを追加 で `.iinaplgz` ファイルを選択
4. IINA を再起動

### 機能

- **Niconico フォーマット完全対応**：Niconico XML、Niconico V1 JSON
- **Bilibili XML 基本対応**：通常スクロールコメント、上部/下部固定コメント（niconico スタイルで描画）
- **デュアル描画モード**：
  - **CSS モード**：WebKit GPU 合成加速（`transform` + `will-change`）により、IINA の WKWebView で Canvas より滑らかに描画
  - **Canvas モード**：改造 niconicomments（CSS レンダラー追加版 fork）、Auto / HTML5 / Flash モード対応
- **自動読み込み**：同じフォルダから優先順位に従って自動検索
- **手動読み込み**：メニューやサイドバーからコメントファイルを選択
- **サイドバーコントロール**：透明度・フォント倍率・描画モードをリアルタイム調整

### 描画モード

| モード | 説明 | 推奨用途 |
|--------|------|----------|
| **CSS** | DOM 要素 + CSS アニメーション、WebKit GPU 加速 | IINA 再生（推奨） |
| **Auto** | HTML5 / Flash を自動判定 | 汎用 |
| **HTML5** | 全コメントを HTML5 モードで描画 | — |
| **Flash** | 全コメントを Flash モードで描画 | — |

Auto・HTML5・Flash はいずれも Canvas 描画で、niconicomments ライブラリの描画方式です。CSS モードはサイドバーの「描画モード」ドロップダウンから選択できます。

### コメントファイルの読み込み

#### 自動読み込み

同じフォルダから以下の優先順位で自動検索：

1. **同名の JSON**：`video.mkv` → `video.json`
2. **同名の XML**：`video.mkv` → `video.xml`
3. **コメント/同名**：`video.mkv` → `コメント/video.xml`（`弾幕` / `Comments` / `コメント` フォルダ名に対応）
4. **コメント/番号**：`video.mkv` → `コメント/3.xml`（ファイル名から話数を抽出）

#### 手動読み込み

- **サイドバー**：「追加」ボタンからコメントファイルを選択
- **メニュー**：プラグイン → Danmaku → コメントファイルを読み込む…
- 複数ファイルの同時読み込み、自動重複排除対応

---

## English

### Installation

1. Install [IINA](https://iina.io/) if you haven't already
2. Download the `.iinaplgz` file from [Releases](https://github.com/karappo-yu/iina-plugin-danmaku-cosmos/releases)
3. Open IINA → Preferences → Plugins → Add Plugin, select the `.iinaplgz` file
4. Restart IINA

### Features

- **Full Niconico format support**: Niconico XML, Niconico V1 JSON
- **Basic Bilibili XML support**: Normal scrolling, top/bottom fixed comments (rendered in niconico style)
- **Dual rendering modes**:
  - **CSS mode**: Leverages WebKit GPU compositing (`transform` + `will-change`) for significantly smoother rendering in IINA's WKWebView
  - **Canvas mode**: Based on a forked [niconicomments](https://github.com/karappo-yu/niconicomments) (with CSS renderer added), with Auto / HTML5 / Flash modes
- **Auto-load**: Automatically searches for danmaku files in the same directory by priority
- **Manual load**: Select danmaku files via menu or sidebar
- **Sidebar control panel**: Real-time adjustment of opacity, font scale, and render mode

### Render Modes

| Mode | Description | Recommended For |
|------|-------------|-----------------|
| **CSS** | DOM elements + CSS animations with WebKit GPU acceleration | IINA playback (recommended) |
| **Auto** | Auto-detect HTML5 / Flash per comment | General use |
| **HTML5** | All comments rendered as HTML5 | — |
| **Flash** | All comments rendered as Flash | — |

Auto, HTML5, and Flash are all Canvas rendering modes from the niconicomments library. CSS mode is selected from the "Render Mode" dropdown in the sidebar.

### Loading Comment Files

#### Auto Load

Automatically searches in the same directory with this priority:

1. **Same name JSON**: `video.mkv` → `video.json`
2. **Same name XML**: `video.mkv` → `video.xml`
3. **Comments/Same name**: `video.mkv` → `Comments/video.xml` (supports `弹幕` / `Comments` / `コメント` folder names)
4. **Comments/Number**: `video.mkv` → `Comments/3.xml` (extracts episode number from filename)

#### Manual Load

- **Sidebar**: Click "Add" to select danmaku files
- **Menu**: Plugins → Danmaku → Load Comment File…
- Multiple files can be loaded simultaneously with automatic dedup

### Notes

- This plugin is designed around the niconico comment style. Bilibili and other Chinese danmaku formats have limited support — they are rendered in niconico style, and Bilibili-specific features like advanced comments (mode 7), scripting comments (mode 8), and BAS comments (mode 9) are not supported
- Comment Art (CA) vertical positioning may differ slightly between CSS and Canvas modes
- Canvas mode CA may appear misaligned in IINA's WebKit renderer (Safari canvas 2D lacks GPU acceleration)
- Filenames with special characters (like `[`, `]`) may cause auto-load to fail
- Minimizing and restoring the window causes danmaku to re-render (known limitation)

---

## Third-Party Libraries

| Library | License | Repository |
|---------|---------|------------|
| [niconicomments](https://github.com/xpadev-net/niconicomments) (forked with CSS renderer) | MIT | https://github.com/karappo-yu/niconicomments |

The MIT License requires that the copyright notice and license text be included in any distribution. The original copyright notices are preserved in the bundled minified JavaScript files distributed with this plugin.

### Patent Notice

The niconicomments author notes that implementing the complete flow of "real-time comment fetching → screen rendering → comment posting" may involve Japanese patents. See [ABOUT_PATENT.md](https://github.com/xpadev-net/niconicomments/blob/develop/ABOUT_PATENT.md) for details.

This plugin is used solely for local playback of saved comment files and does not involve real-time fetching or posting functionality.

---

## License

MIT License.
