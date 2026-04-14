# Damaku Cosmos

[日本語](#日本語) / [中文](#中文) / [English](#english)

![Installation](sh/sh1.png)

> ※ 上图为演示用途，仅展示插件弹幕渲染效果。
> 实际使用时请自行从合法渠道获取 NicoNico 评论（コメント）。
> 本插件不提供任何弹幕文件。
>
> ※ This image is for demonstration only, showing the plugin's danmaku rendering.
> Please obtain NicoNico comments (コメント) from legitimate sources.
> This plugin does not provide any danmaku files.
>
> ※ この画像は演示用です。コメント描画の效果を示すものです。
> コメントは各自の責任において NicoNico など合法的なサービスから取得してください。
> このプラグインはコメントファイルを提供しません。

IINA danmaku plugin supporting Niconico and Bilibili formats.

---

## 日本語

IINA 用コメントプラグイン。Niconico 形式と Bilibili 形式のコメントに対応。

### インストール

1. [Releases](https://github.com/karappo-yu/iina-plugin-damaku-cosmos/releases) から `.iinaplgz` ファイルをダウンロード
2. IINA → 設定 → プラグイン → プラグインを追加 で `.iinaplgz` ファイルを選択
3. IINA を再起動

### コメントファイルの読み込み

#### 自動読み込み

同じフォルダから以下の優先順位で自動検索：

1. **同名の XML**：`video.mkv` → `video.xml`
2. **コメント/同名**：`video.mkv` → `コメント/video.xml`（日本語/英語/中国語のフォルダ名に対応）
3. **コメント/番号**：`video.mkv` → `コメント/3.xml`（ファイル名から話数を抽出）

#### 手動読み込み

メニュー **プラグイン → Damaku Cosmos → コメントファイルを読み込む…** から XML ファイルを選択。

### 対応形式

- **Niconico 形式**（`<chat>` タグ）
- **Bilibili 形式**（`<d>` タグ）

### コメントレート制限

**レート制限機能は非推奨**。理由：

1. **再読み込みが必要**：パラメータ変更後、コメントを再読み込みしないと適用されない
2. **価値あるコメントが削除される可能性**：ランダムサンプリングは高価値なコメントも無差別に削除する
3. **時間密度が平準化される**：ランダムサンプリングはコメント分布を均一化し、コメント密集の瞬間が薄まる

### 注意事項

- ファイル名に特殊文字（`[`、`]`など）が含まれる場合、自動読み込みに失敗する可能性がある
- ウィンドウを最小化してから復元すると、コメントが再レンダリングされる（既知の制限）

---

## 中文

IINA 弹幕插件，支持 Niconico 格式与 Bilibili 格式弹幕。

### 插件安装

1. 从 [Releases](https://github.com/karappo-yu/iina-plugin-damaku-cosmos/releases) 下载 `.iinaplgz` 文件
2. 打开 IINA，设置 → 插件 → 添加插件，选择下载的 `.iinaplgz` 文件
3. 重启 IINA

### 弹幕文件加载

#### 自动加载

插件会按以下优先级自动查找同目录下的弹幕文件：

1. **同名 XML**：`video.mkv` → `video.xml`
2. **弹幕/同名**：`video.mkv` → `弹幕/video.xml`（支持中文/英文/日文文件夹名）
3. **弹幕/序号**：`video.mkv` → `弹幕/3.xml`（从文件名提取集数）

#### 手动加载

使用菜单 **插件 → Damaku Cosmos → 手动加载弹幕文件…** 选择 XML 文件。

### 支持的弹幕格式

- **Niconico 格式**（`<chat>` 标签）
- **Bilibili 格式**（`<d>` 标签）

### 弹幕限流

**不建议开启弹幕限流功能**。原因：

1. **必须重新加载才生效**：修改限流参数后需要重新加载弹幕文件才能应用
2. **可能过滤有价值弹幕**：随机采样会无差别丢弃弹幕，可能丢失高价值评论
3. **削平时间密度**：随机采样会均匀化弹幕分布，原本弹幕密集的精彩瞬间会被稀释

### 注意事项

- 文件名包含特殊字符（如 `[`、`]`）可能导致自动加载失败
- 最小化窗口后再恢复，弹幕会重新渲染（已知限制）

---

## English

A danmaku/comment plugin for IINA. Supports both Niconico and Bilibili comment formats.

### Installation

1. Download the `.iinaplgz` file from [Releases](https://github.com/karappo-yu/iina-plugin-damaku-cosmos/releases)
2. Open IINA → Preferences → Plugins → Add Plugin, select the `.iinaplgz` file
3. Restart IINA

### Loading Comment Files

#### Auto Load

Automatically searches in the same directory with this priority:

1. **Same name XML**: `video.mkv` → `video.xml`
2. **Comments/Same name**: `video.mkv` → `Comments/video.xml` (supports Chinese/English/Japanese folder names)
3. **Comments/Number**: `video.mkv` → `Comments/3.xml` (extracts episode number from filename)

#### Manual Load

Use menu **Plugins → Damaku Cosmos → Load Comment File…** to select an XML file.

### Supported Formats

- **Niconico format** (`<chat>` tags)
- **Bilibili format** (`<d>` tags)

### Rate Limiting

**Rate limiting is not recommended** because:

1. **Requires reload**: Changes only take effect after reloading the comment file
2. **May filter valuable comments**: Random sampling discards all comments indiscriminately
3. **Flattens time density**: Random sampling evens out comment distribution, diluting intense moments

### Notes

- Filenames with special characters (like `[`, `]`) may cause auto-load to fail
- Minimizing and restoring the window causes danmaku to re-render (known limitation)