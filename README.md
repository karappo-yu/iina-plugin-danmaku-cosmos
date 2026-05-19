# Danmaku Cosmos

[日本語](#日本語) / [中文](#中文) / [English](#english)

IINA 弹幕插件，基于 [niconicomments](https://github.com/xpadev-net/niconicomments)（已 fork 增强）。支持 Niconico 格式（XML / V1 JSON）、Bilibili XML、以及**弹弹play 网络弹幕**。CSS 和 Canvas 双渲染模式。

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
- **弹弹play 网络弹幕**：自动匹配视频文件，从弹弹play API 获取网络弹幕，支持缓存和手动搜索
- **双渲染模式**：
  - **CSS 模式**（默认）：利用 WebKit GPU 合成加速（`transform` + `will-change`），在 IINA 的 WKWebView 环境下流畅度远超 Canvas
  - **Canvas 模式**：基于魔改 niconicomments，用于需要完整 Canvas 渲染的场合
- **自动加载弹幕**：按优先级自动查找同目录下的弹幕文件
- **手动加载弹幕**：通过菜单或侧边栏手动选择弹幕文件
- **侧边栏控制面板**：实时调整弹幕开关、渲染模式、透明度、字体缩放等

### 网络弹幕

插件集成了弹弹play（dandanplay）开放平台 API，可自动为视频匹配并加载网络弹幕。

- **自动匹配**：优先根据文件 hash 精确匹配（自动加载），失败后根据视频文件名匹配（显示候选列表供选择）
- **手动搜索**：上述匹配均失败时，可手动搜索番剧名称，从搜索结果中选择
- **弹幕缓存**：网络弹幕缓存到本地，24 小时内重复播放无需重新下载
- **自动加载开关**：开启后自动匹配并加载网络弹幕；关闭时优先使用本地弹幕，网络弹幕仅在手动选择时加载
- **弹幕冲突处理**：网络弹幕和本地弹幕同时存在时，根据优先级自动选择

> **注意**：弹弹play 提供的网络弹幕内容以简体中文和繁体中文为主，不包含其他语言。

### 渲染模式

| 模式 | 说明 | 推荐场景 |
|------|------|----------|
| **CSS**（默认） | DOM 元素 + CSS 动画，WebKit GPU 加速 | IINA 播放（推荐） |
| **Canvas** | Canvas 2D 渲染，niconicomments 引擎 | CSS 模式效果不理想时 |

在侧边栏「高级设置」中切换渲染模式。

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
- **弹弹play ネットワークコメント**：動画ファイルを自動認識し、弹弹play API からネットワークコメントを取得。キャッシュ対応、手動検索可能
- **デュアル描画モード**：
  - **CSS モード**（デフォルト）：WebKit GPU 合成加速（`transform` + `will-change`）により、IINA の WKWebView で Canvas より滑らかに描画
  - **Canvas モード**：改造 niconicomments、Canvas 描画が必要な場合に使用
- **自動読み込み**：同じフォルダから優先順位に従って自動検索
- **手動読み込み**：メニューやサイドバーからコメントファイルを選択
- **サイドバーコントロール**：コメント表示、描画モード、透明度、フォント倍率などをリアルタイム調整

### ネットワークコメント

弹弹play（dandanplay）プラットフォームの API を統合し、動画にネットワークコメントを自動マッチングして読み込みます。

- **自動マッチング**：ファイルハッシュによる完全一致（自動読み込み）→ ファイル名による曖昧一致（候補一覧表示）の順で試行
- **手動検索**：上記が全て失敗した場合、番組名を手動検索可能
- **キャッシュ**：ネットワークコメントはローカルにキャッシュされ、24時間以内の再再生では再ダウンロード不要
- **自動読み込みトグル**：ON で自動マッチング＋自動読み込み、OFF では優先的にローカルコメントを使用
- **競合処理**：ネットワークコメントとローカルコメントが共存する場合、優先設定に従って自動選択

> **注意**：弹弹play から提供されるネットワークコメントは簡体字中国語・繁体字中国語が主体で、他の言語は含まれません。

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

> **Note**: This plugin is designed around the niconico comment style. Bilibili and other Chinese danmaku formats have limited support — they are rendered in niconico style, and Bilibili-specific features like advanced comments (mode 7), scripting comments (mode 8), and BAS comments (mode 9) are not supported.

### Installation

1. Install [IINA](https://iina.io/) if you haven't already
2. Download the `.iinaplgz` file from [Releases](https://github.com/karappo-yu/iina-plugin-danmaku-cosmos/releases)
3. Open IINA → Preferences → Plugins → Add Plugin, select the `.iinaplgz` file
4. Restart IINA

### Features

- **Full Niconico format support**: Niconico XML, Niconico V1 JSON
- **Basic Bilibili XML support**: Normal scrolling, top/bottom fixed comments (rendered in niconico style)
- **Dandanplay network danmaku**: Auto-match videos via dandanplay API, with caching and manual search
- **Dual rendering modes**:
  - **CSS mode** (default): DOM elements + CSS animations with WebKit GPU acceleration for smooth rendering in IINA's WKWebView
  - **Canvas mode**: Based on a forked niconicomments library, for when Canvas rendering is needed
- **Auto-load**: Automatically searches for danmaku files in the same directory by priority
- **Manual load**: Select danmaku files via menu or sidebar
- **Sidebar control panel**: Real-time adjustment of danmaku visibility, render mode, opacity, font scale, and more

### Network Danmaku

The plugin integrates the dandanplay open platform API for automatic network danmaku matching and loading.

- **Auto-match**: First tries file hash (auto-load on exact match), then falls back to filename matching (shows candidate list)
- **Manual search**: Search by anime name when both matching methods fail
- **Cache**: Network danmaku is cached locally; replay within 24 hours skips re-download
- **Auto-load toggle**: ON for automatic network matching + loading; OFF prefers local files
- **Conflict resolution**: When both local and network danmaku exist, priority setting determines which to use

> **Note**: Network danmaku provided by Dandanplay is predominantly Simplified Chinese and Traditional Chinese — other languages are not available.

### Render Modes

| Mode | Description | Recommended For |
|------|-------------|-----------------|
| **CSS** (default) | DOM elements + CSS animations with WebKit GPU acceleration | IINA playback (recommended) |
| **Canvas** | Canvas 2D rendering via niconicomments engine | When CSS mode doesn't suit |

Toggle between modes in the sidebar's Advanced settings.

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
