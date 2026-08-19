# 图标应用交接(Gooey 定稿)

> 由 logo 设计对话交接(源线程 01a014b1-…)。目标:把定稿图标接入 my-ssh 应用。

## 定稿方案

- **Gooey**(goo 滤镜有机融合),黑色主色,`currentColor` 可换色
- 源文件:`docs/logo/final/myssh-icon.svg`
- 图标集:`docs/logo/final/myssh-icon-{16,32,64,128,256,512,1024}.png`(透明背景)
- 绿色变体(品牌 `--ok: #30d158`):`docs/logo/final/myssh-icon-green-*.png`
- 展示页:浏览器打开 `docs/logo/showcase.html`(Gooey 卡片已标「定稿」)

## 已接入(源对话完成)

- 构建图标:`build/icon.png`(1024)、`build/icon.icns`(macOS)、`build/icon.ico`(Windows 6 尺寸)、`build/icons/`(Linux 7 尺寸)
- `electron-builder.yml` 已为 mac/win/linux 配置 icon
- `README.md` 顶部已加 logo

## 已接入(后续对话完成)

1. **窗口/Dock 图标(开发态)**:`src/main/index.ts` 的 `BrowserWindow` 增加 `icon`(取 `build/icon-tile.png` 白圆角磁贴版,仅文件存在时设置);macOS 开发态另用 `app.dock.setIcon()` 设置 Dock 图标(`dock.setIcon` 直出不会套系统圆角遮罩,故用圆角图)
2. **可选 favicon**:渲染进程 `index.html` 加 `<link rel="icon">`(用 32px 图,electron-vite 放 `src/renderer/public/`)
3. **可选**:设置页/关于/侧边栏使用 logo 呼应品牌
4. **验证**:`make build && npx electron-builder --dir --mac` 打包,确认 `.app/.exe/.AppImage` 图标生效(本地打包需网络下载工具链,CI `make release-*` 会自动用这些图标)

5. **边缘规范(白圆角磁贴)**:1024 主图(`myssh-icon-white-tile-1024.png`)圆角边缘本身是 0/255 硬边;缩放产生的白色半透明毛边会在界面/小尺寸图标上形成「白边渐变」。按通用图标规范,所有下发尺寸做边缘二值化(纯白半透明像素 alpha≥128→255,否则→0;字形 AA 保持不动):
   - `build/icon-tile.png`(1024,Dock 开发态)
   - `src/renderer/src/assets/myssh-icon-tile.png`(256,界面)
   - `build/icons/{16,32,48,64,128,256,512}x{n}.png`(Linux)
   - `build/icon.ico`(16/24/32/48/64/128/256,Windows;手动组装,避免 PIL 自缩放重新引入毛边)
   - macOS `icon.icns`/iconset 保持全出血方版,圆角由系统遮罩负责,无需处理

6. **macOS dev 显示名与 Dock 图标**:
   - dev 直接跑 `node_modules` 的 Electron.app 时,Dock/菜单栏显示名是 bundle 的 `CFBundleDisplayName`(即 "Electron")。`npm run dev` 现在走 `scripts/dev.mjs`:macOS 下复制一份 Electron.app 到 `.dev/dist/` 并把显示名改为 `my-ssh`,通过 `ELECTRON_EXEC_PATH` 让 electron-vite 用它启动(`app.setName('my-ssh')` 兜底)。首次运行会复制约 300MB,之后缓存复用;`rm -rf .dev` 可强制重建。
   - Dock 图标用 256px 硬边磁贴(`build/icon-tile-dock.png`),避免 1024 图缩放到 Dock 尺寸时产生白色边缘渐变;窗口图标仍用 1024 磁贴(`build/icon-tile.png`)。
