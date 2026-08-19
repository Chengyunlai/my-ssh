# 贡献指南(Contributing Guide)

感谢你愿意为 MySSH 贡献力量。本文档是开发约定与协作流程的权威说明,提交 PR 前请通读。

## 环境要求

- Node.js `^20.19.0 || >=22.12.0`(建议 22 LTS,与 CI 一致)
- npm `>=10`
- macOS / Linux / Windows 均可开发;打包各平台产物由 CI 完成

```bash
make install   # npm ci,基于 package-lock.json 可复现安装
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `make dev` | 启动开发模式(主进程 / 渲染进程热更新) |
| `make typecheck` | 类型检查(main + renderer + shared) |
| `make build` | 构建到 `out/` |
| `make dist` | 本地打包 macOS dmg 到 `dist/` |
| `make check` | 提交前自检:typecheck + build |
| `make clean` | 清理 `out/`、`dist/` |

所有命令都可在 `package.json` 中找到对应的 npm script,Makefile 只是入口封装。

## 代码组织与约定

```text
src/
  main/        # Electron 主进程:窗口、profiles 加密存储、ssh2 / sftp 会话
  preload/     # contextBridge 桥接,向渲染进程暴露 window.ssh API
  renderer/    # React 界面 + xterm.js 终端 + 插件注册表
  shared/      # 主进程与渲染进程共享的类型(两侧均可 import)
```

- **进程边界**:渲染进程只能通过 `window.ssh.*`(preload 暴露)访问能力,不得直接接触 Node / 主进程。
- **大体积逻辑放主进程**:SFTP 传输等重活放 `src/main/`,经 IPC 暴露,避免在渲染进程阻塞 UI。
- **类型共享**:跨进程类型放 `src/shared/types.ts`,通过 `@shared/*` 别名引入,不要复制粘贴。
- **插件**:内置插件见 [`docs/PLUGIN.md`](docs/PLUGIN.md),改插件行为前先读;插件注册表在 `src/renderer/src/plugins/`。
- **UI 动效与设计规范**:见 [`docs/UI.md`](docs/UI.md)。评审 UI 改动须按其中「评审清单」逐项核对。
- **新增依赖**:用 `npm install <pkg>`(会更新 lockfile),提交时必须包含 `package-lock.json`。

## 提交规范(Conventional Commits)

提交信息格式:`<type>(<scope>): <subject>`,如:

- `feat(sftp): 支持文件夹递归上传`
- `fix(ssh): 修复断线后重连失败`
- `docs: 更新插件开发文档`
- `refactor(main): 抽取会话管理模块`
- `test(profiles): 补充加密存储用例`
- `chore: 升级 electron 到 43`

- type 常用:`feat` / `fix` / `docs` / `refactor` / `test` / `chore` / `perf` / `style`
- subject 用中文或英文均可,保持仓库现状一致;一条提交只做一件事。

## 分支与 PR 流程

1. 从最新 `master` 拉分支:`git checkout -b feat/sftp-recursive-upload`(命名建议 `type/简述`)。
2. 开发并本地自检:`make check` 必须通过。
3. 涉及插件 / UI 改动,对照 `docs/PLUGIN.md`、`docs/UI.md` 检查。
4. 推送分支,发起 PR 到 `master`,在描述中说明:改了什么、为什么、如何验证(附截图更佳)。
5. 维护者 review 后合并;CI 会在 PR 上自动跑类型检查与构建。

## 发布流程(版本迭代)

发布完全由「打 tag + CI 自动打包」驱动,不需要本地打包产物:

```bash
make release-patch   # 或 release-minor / release-major
```

该命令会:更新 `package.json` 版本号 → 生成提交 → 打 `vX.Y.Z` tag → 推送。
推送后 GitHub Actions 自动构建 **macOS(dmg) / Windows(nsis) / Linux(AppImage)** 并发布到
[GitHub Releases](https://github.com/Chengyunlai/my-ssh/releases),用户直接下载安装即可。

手工发布(不常用):

```bash
git tag v0.1.1 && git push origin v0.1.1
```

发布前请确认 README 中的路线图、依赖说明与本次版本一致;破坏性变更要在 Release Notes 中注明。

发布前把本版本的变更整理进 [`CHANGELOG.md`](CHANGELOG.md)(开发者日志),与版本号提交一起推送。

## 安全约定

- 严禁提交任何私钥、密码、`profiles.json` 等敏感数据;`*.log`、`node_modules/`、`out/`、`dist/` 已在 `.gitignore`。
- 凭据落盘必须走 Electron `safeStorage` 加密,不要自研明文存储。
- 外部插件运行在受限环境,插件只能调用 `window.ssh.*`;新增主进程能力时评估最小暴露面。
