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
| `make lint` | Oxc 静态代码检查 |
| `make test` | Vitest 单元测试 |
| `make typecheck` | 类型检查(main + renderer + shared) |
| `make build` | 构建到 `out/` |
| `make dist` | 本地打包 macOS dmg + zip 到 `dist/` |
| `make check` | 提交前自检:lint + typecheck + test + build |
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
- **架构边界**:进程依赖方向和功能落点见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。
- **Agent 并行开发**:任务认领、共享文件和交接规则见 [`AGENTS.md`](AGENTS.md)。

## Issue 规范

- Bug、功能建议和工程任务分别使用对应 Issue Form,先搜索已有 Issue,避免重复。
- Issue 必须说明背景、范围 / 非目标、验收条件、风险和依赖;日志与截图必须脱敏。
- 可并行任务要声明模块或文件边界,共享文件指定唯一负责人。
- 安全漏洞不得公开提交,按 [`SECURITY.md`](SECURITY.md) 私密报告。

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

1. 关联或创建 Issue,确认范围与验收条件。
2. 从最新 `master` 拉分支:`git checkout -b feat/sftp-recursive-upload`(命名建议 `type/简述`)。
3. 开发并本地自检:`make check` 必须通过。
4. 涉及插件 / UI 改动,对照 `docs/PLUGIN.md`、`docs/UI.md` 检查。
5. 推送分支,发起 PR 到 `master`,按模板说明:改了什么、为什么、如何验证、风险与回滚方式。
6. CI 自动执行 lint、类型检查、单元测试、构建和 critical 级生产依赖审计。
7. 至少一名 CODEOWNER Review 后合并;推荐 squash merge,合并后删除功能分支。

维护者应在 GitHub 为 `master` 开启分支保护:禁止直接推送,要求 `CI / Lint, Typecheck, Test & Build`
通过、至少一次批准并要求对话已解决。仓库配置未启用这些规则时,文档约定不能替代远端门禁。

## 发布流程(版本迭代)

发布完全由「打 tag + CI 自动打包」驱动,不需要本地打包产物:

```bash
make release-patch   # 或 release-minor / release-major
```

该命令会:更新 `package.json` 版本号 → 生成提交 → 打 `vX.Y.Z` tag → 推送。
推送后 GitHub Actions 自动构建 **macOS(dmg + zip) / Windows(nsis) / Linux(AppImage)** 并发布到
[GitHub Releases](https://github.com/Chengyunlai/my-ssh/releases),用户直接下载安装即可。

手工发布(不常用):

```bash
git tag v0.1.1 && git push origin v0.1.1
```

发布前请确认 [`ROADMAP.md`](ROADMAP.md)、README、依赖说明与本次版本一致;破坏性变更要在
Release Notes 中注明。

发布前把本版本的变更整理进 [`CHANGELOG.md`](CHANGELOG.md)(开发者日志),与版本号提交一起推送。

## 安全约定

- 严禁提交任何私钥、密码、`profiles.json` 等敏感数据;`*.log`、`node_modules/`、`out/`、`dist/` 已在 `.gitignore`。
- 凭据落盘必须走 Electron `safeStorage` 加密,不要自研明文存储。
- 外部插件运行在受限环境,插件只能调用 `window.ssh.*`;新增主进程能力时评估最小暴露面。
- `npm audit` 报告必须人工审查;CI 阻止 critical 级生产依赖漏洞,较低级别风险进入 Issue 跟踪。
