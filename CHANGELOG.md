# 开发者日志(Changelog)

本文件记录 MySSH 每一次版本迭代的内容。所有用户可见的功能、修复与工程变更,都会在发版时汇总到这里。

## 维护约定

- 新版本条目加在**最上方**(最新在上),格式:版本号 + 发布日期 + 分组清单(`新增` / `修复` / `改进` / `文档` / `工程化`)
- 每次发版(`make release-*` 或手动打 tag)前,把本版本变更整理进 `CHANGELOG.md` 并一并提交
- 参考提交历史(`git log`)与 PR 描述整理条目,分类与[提交规范](CONTRIBUTING.md)保持一致
- 破坏性变更必须在条目中显著标注

## 未发布

<!-- 新版本的变更在这里积累,发版时把内容挪到下方新版本条目里。 -->

## [1.0.1] - 2026-08-19

- **修复**:macOS 打包图标直角边问题 — 源图改为 100% 不透明全出血白底,新增 `make icon` 一键重建,CI 打包前自动执行
- **改进**:图标工作流规范化,`scripts/prepare-macos-icon.mjs` 支持 `--check` 校验
- **文档**:README 同步 v1.0.0 下载链接与示例版本;补充 macOS 未签名构建的安装说明
- **工程化**:release workflow 在 macOS 打包前重建图标资源

## [1.0.0] - 2026-08-19

首个正式版本。

- **新增**:应用自动更新 — 接入 `electron-updater`,启动时静默检查,设置页「关于」支持手动检查 / 下载 / 重启安装;发布到 GitHub Releases 自动生成更新索引
- **新增**:设置页插件管理与插件市场表格化 — 分类筛选、官方徽章、版本兼容校验(minAppVersion)
- **新增**:官方插件治理 — `official` / `category` / `minAppVersion` 贯穿市场 registry → 插件 manifest → 安装校验全链路
- **改进**:连接与文件预览进度条(阶段上报 + 平滑动效),文件面板切回时自动刷新
- **文档**:新增 [`docs/RELEASE.md`](docs/RELEASE.md) 发布与自动更新流程、[`docs/PLUGIN.md`](docs/PLUGIN.md) 插件分类与兼容规范
- **工程化**:CI 升级 checkout / setup-node 到 v5,消除 Node 20 弃用警告

## [0.1.0] - 2026-08-18

首个 CI 自动发布版本(预发布)。

- **新增**:桌面 SSH 客户端核心功能 — 服务器可视化管理(账号密码 / PEM 私钥,safeStorage 加密落盘)+ 完整桌面终端(xterm.js)
- **新增**:SFTP 内置插件 — `fastGet` / `fastPut` 并发传输、在线预览与编辑(文本高亮 / 图片 / Office 文档)、实时进度
- **新增**:外部插件市场 — 自定义协议 `myssh-plugin://` 运行时加载,可安装 / 启用 / 卸载;默认加载官方在线市场
- **工程化**:补齐 electron-vite / electron-builder / GitHub Actions 自动打包发布(macOS / Windows / Linux)
- **文档**:UI 动效与设计规范 [`docs/UI.md`](docs/UI.md)、插件开发规范 [`docs/PLUGIN.md`](docs/PLUGIN.md)
