# MySSH Logo

> ✅ **已定稿:Gooey(variant-07)** — 用户选定,已接入应用构建。最终资产见 `final/`,构建图标见 `build/`。

基于 [op7418/logo-generator-skill](https://github.com/op7418/logo-generator-skill) 生成的 logo 设计。

当前方向:**几何构造 / 黄金比例 / 分圆**(用户反馈:要抽象,但要有可推导的逻辑——黄金比例、圆的划分、尺规作图)。

## 目录

```text
docs/logo/
  showcase.html          # 交互式对比页(浏览器直接打开,01 当前方向 + 02/03/04 探索档案)
  geometry/              # ★ 当前方向:几何构造(SVG + PNG + preview.png)
    geo-01-golden-angle.svg     # 黄金角:圆被 137.5° 半径分成 222.5°:137.5° = φ
    geo-02-vesica.svg           # 双圆透镜:两等圆圆心互为对方圆周,透镜=连接
    geo-03-spiral.svg           # 黄金螺旋:斐波那契正方形 5,5,10,15,25,40 逐段旋转
    geo-04-rings.svg            # φ 同心环:半径 1:φ:φ² + 黄金角半径切分
    geo-05-dial.svg             # 刻度分圆:12 条 30° 理性刻度 + 137.5° 黄金弧
    geo-06-node.svg             # φ 节点:主圆与 1/φ 卫星圆交叠,透镜点亮
  structured/           # 探索档案:结构化 / 逻辑感(SVG + PNG)
  variants/             # 探索档案:12 个早期变体(SVG + PNG)
  gooey/                # 已放弃方向(Gooey),仅存档
  png/                  # 早期变体透明背景 1024×1024 PNG
```

## 几何逻辑(可在展示页中验证)

- **黄金角** 137.507764°:圆被分成两段弧,比值 222.5°:137.5° ≈ 1.618 = φ
- **斐波那契螺旋**:每段圆弧半径 = 所在正方形边长(5,5,10,15,25,40),首尾相切
- **同心环**:半径 16.5 / 26.7 / 43.2,相邻比 ≈ φ
- **Vesica Piscis**:两个半径相等的圆,圆心距 = 半径
- **φ 节点**:卫星圆半径 = 主圆 / φ,透镜为两圆交叠

所有方案均为纯 SVG 几何(圆、弧、直线),无滤镜依赖,任何渲染器可用。

## 使用

- 打开 `showcase.html` 对比变体,每个卡片可下载对应 SVG。
- SVG 使用 `currentColor`,通过外层 CSS `color` 换色;品牌色见 `docs/UI.md`(`--accent: #0a84ff`、`--ok: #30d158`)。

## Phase 4:高定展示图(可选)

选定最终方向后,可调用 skill 的 Nano Banana 生成 12 种专业背景展示图:

```bash
cd <skill 目录>
cp .env.example .env        # 填入 GEMINI_API_KEY
pip install -r requirements.txt
python scripts/generate_showcase.py --all-styles --logo png/<final-variant>.png
```

## 导出 PNG(无需 cairosvg)

本机使用项目自带的 Electron 渲染 SVG → 透明 PNG(见各 `png/` 目录),替代 skill 的 `scripts/svg_to_png.py`(依赖 cairosvg)。

## 最终定稿(Gooey)

- 来源:早期变体 `variants/variant-07-gooey.svg`(Gooey 滤镜,有机融合)
- 最终资产:`final/myssh-icon.svg` + 黑色图标集 `myssh-icon-{16..1024}.png`、绿色变体 `myssh-icon-green-*`

## 白底黑 logo(应用图标统一方案)

应用图标与界面 logo 统一为「白底 + 黑色字形」:

- `final/myssh-icon-white-1024.png` — 全出血白底主图(macOS 图标,系统自动套圆角遮罩),即 `build/icon.png`
- `final/myssh-icon-white-tile-1024.png` — 白圆角磁贴版(Windows / Linux 图标、界面 logo 共用)
- `build/icon.icns` / `build/icon.ico` / `build/icons/` 均由上述两版生成
- 界面 logo 使用 `src/renderer/src/assets/myssh-icon-tile.png`(顶栏 / 空状态 / 关于页),不再做 CSS 反白
- 应用构建图标(项目根 `build/`):`icon.png`(1024)、`icon.icns`(macOS)、`icon.ico`(Windows)、`icons/`(Linux 多尺寸)
- 换色:SVG 为 `currentColor`,改外层 `color` 即可;绿色版为品牌 `--ok: #30d158`
