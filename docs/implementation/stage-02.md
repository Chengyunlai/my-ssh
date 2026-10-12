# TUI 三平台验收与 1.4.0 发布准备

- Issue：[#27](https://github.com/Chengyunlai/my-ssh/issues/27)；[设计记录](../plans/core-tui.md)。
- PR：[#28](https://github.com/Chengyunlai/my-ssh/pull/28)。
- 基线：`bb8cd721ea5e9f092345acbb1d419fe80bcabe7e`，共享 Core 与 TUI 的原始实现。
- 终端验收实现：`74cd4fc46c47c68d85aa039fed0dfdb060491c7b`，
  `test(tui): 在三平台验证终端交互与文件操作`（中文、test/tui）。
- 发布准备：`5881226fdc1c53b782c8ed7d8544694a14d3a52c`，
  `chore(release): 准备 1.4.0 共享核心与终端版本发布`（中文、chore/release）。
- Windows 宿主修正：`111c4ae119067d473e9d41cab4720087fe1a286b`，
  `fix(test): 让 ConPTY 提供 Windows 控制台句柄`（中文、fix/test）。
- 分支：`codex/feat/core-tui`；记录语言中文。
- 本轮范围：跨平台操作验收及发布准备，未增加外部 React 插件适配。
- 核心行为和权限边界保持原实现；新增代码只在测试宿主中运行。

## 可回放入口

沿用 [user_code](../../examples/stage-01-core-tui/user_code/README.md)：`npm run example:core`。
公开 Core 的 `createCore → connect → sendData → sftp.read → dispose` 返回
`CORE_OK 你好` / `Hello SFTP`；核心映射见原 Example 的 `core/README.md`。

`npm run verify:tui` 创建回环虚拟 SSH 服务，启动编译后的 TUI，
用真实终端输入创建/编辑/删除加密连接配置、测试认证、执行中文回显、
多 Shell 切换及屏幕恢复、预览并调用独立编辑器写回、上传/下载、递归删除测试目录，
查看监控及服务，最后断开和退出。编辑器和全部本地文件只位于独立临时目录。

Windows 测试宿主使用原生 ConPTY，无新增依赖；输出线程持续读取，避免关闭时管道死锁。
ConPTY 可能仅输出屏幕差量，`tui-test-screen.mjs` 通过既有 headless xterm 还原可见文本。
macOS/Linux 使用 Unix PTY。断点：`terminal_process.py::WindowsTerminal` 的进程创建/清理、
`verify-tui.py::expect` 的可见文本与当前输出；真实业务仍沿原 Example 的 Core 断点观察。

## 验证证据

- 原始实现三平台 CI：[38198441107](https://github.com/Chengyunlai/my-ssh/actions/runs/38198441107) 全部通过。
  该版本 Windows 仅验证构建与独立安装，不能计入 Windows 交互证明。
- 本轮本地 PTY：配置 CRUD、编辑器、文件传输/递归删除、多 Shell 中文恢复等通过。
- `MYSSH_VERIFY_SCREEN=1 node scripts/verify-tui.mjs`：macOS 通过屏幕解析模式操作链，
  与 Windows 共用 VT 差量解释器；这不代替 Windows ConPTY 验证。
- 三平台完整验收：[38199826202](https://github.com/Chengyunlai/my-ssh/actions/runs/38199826202)
  在 `111c4ae` 上全部通过：lint、类型检查、258 测试、构建、独立 tgz 安装、
  Unix PTY / Windows ConPTY 配置 CRUD、多 Shell 恢复、SFTP 编辑/传输/递归删除、
  监控及服务操作链，high/critical 生产依赖审计和统一门禁均通过。
- Windows 初次交互 [38199454518](https://github.com/Chengyunlai/my-ssh/actions/runs/38199454518)
  发现测试宿主继承 CI 的非终端 stdio；已按 Microsoft node-pty 的启动方式显式设置
  `STARTF_USESTDHANDLES` / null std handles，交由 ConPTY 提供控制台句柄；上面的修正后 CI 已通过。
- `make check`：lint、Node/renderer 类型检查、28 文件 / 258 测试、桌面与 TUI 构建通过。
- `npm run verify:tui-package`：1.4.0 tgz（约 85 KB）在临时目录脱离仓库安装通过，
  不安装 Electron/React，CJS/ESM/TypeScript 入口、SSH/SFTP 调用及非 TTY 拒绝通过。
- 本轮真实 Electron preload/IPC：SSH、多 Shell、SFTP、监控和服务发现通过。

## 发布状态与边界

远程保护要求 CI、CODEOWNER 批准和最后推送审批。当前 PR 作者和 CODEOWNER 同为
`Chengyunlai`，GitHub 不允许作者自审。用户于 2026-10-12 明确授权仅本次管理员合入并发布
1.4.0；仓库保护规则保持不变，最终提交仍须通过三平台 CI。

发布链路：合入主分支 → 推送 `v1.4.0` → Release 工作流汇总桌面三平台资产及平台无关 TUI tgz
→ 校验精确 11 文件资产合同 → 发布。实际合入与发布状态以
[PR #28](https://github.com/Chengyunlai/my-ssh/pull/28) 和
[Release v1.4.0](https://github.com/Chengyunlai/my-ssh/releases/tag/v1.4.0) 为准。

仍需 Node.js；外部 React 插件未适配；媒体/Office/PDF 下载后本地查看；桌面 vault 不自动迁移。
Windows Terminal 的 IME/字体及不同终端的复杂远端应用体验不等于自动测试的验收范围。
