# 终端兼容性、预览与第三方作者接入

关联 [Issue #35](https://github.com/Chengyunlai/my-ssh/issues/35)，[设计](../plans/tui-compatibility.md)。
基线 `46da5ffca47c237ead0877659c48e27e872097b3`，分支 `codex/feat/tui-compatibility`，开始时干净。
修复提交 `b521b51`；功能提交 `e3afd44`，记录提交不自引用。
本阶段准备 1.6.0；合入/发行状态以 [PR #36](https://github.com/Chengyunlai/my-ssh/pull/36) 与 [Release](https://github.com/Chengyunlai/my-ssh/releases/tag/v1.6.0) 为准，不把本地构建算作已公开发布。

## 用户可见行为与改动

- DOCX 标题/列表/表格、PPTX 顺序分页，DIB ICO 和 TIFF 多帧；保留旧格式下载与 Worker 边界。
- 公共 `myssh-tui/plugin` 与 CLI `--validate-plugin`，作者共用业务数据；自建市场安装默认停用、不显示官方徽章。
- 输入跨块 UTF-8 拼接，Core 首次输入结束初始化过滤；OSC 7 的 BEL/ST 和有界片段解析，其他 OSC 不截留。
- Windows `--wsl` 直接入口，列表取消和子进程生命周期；真实 WSL 的 ConPTY 验证脚本。
- 独立包验证导入/类型/CLI/市场/非法能力拒绝，现有插件 PTY 链使用同一个作者示例生成命令贡献。

主要文件：`src/core/{shell-output,ssh,sftp,index}.ts`，`src/shared/tui-plugin.ts`，
`src/tui/{office-content,ico,preview-render,index,shells,wsl}.ts`，`scripts/verify-*`、WSL CI 脚本和三平台工作流。
桌面 IPC 不增加 rawBinary 或任意插件执行接口；renderer/preload 的调用方式保持兼容。

示例按 [user_code](../../examples/stage-05-tui-compatibility/user_code/README.md) →
[Core 映射](../../examples/stage-05-tui-compatibility/core/README.md) 阅读；ADR [0007](../adr/0007-tui-compatibility.md)。
断点以 `validateTuiPlugin`、`officeContent`、`decodeIcon`、`CwdOutput.push`、`ShellScreens.attach`、`runWslDistribution` 为准。

## 本地验证

- `make check`：lint、两侧类型、40 文件 / 307 测试、桌面/TUI 构建通过。
- 独立 tgz：Core/MySQL/插件 CJS/ESM 与严格 TypeScript 类型消费，真实回环 SSH/MySQL，CLI 校验与自建市场安装通过。
- `npm run verify:tui-plugins`：真实键盘的第三方命令/安装启停/数据库/CSV/参数化修改/实时监控链通过。
- `node scripts/verify-tui-terminal.mjs`：真实 Unix PTY 的 Vim/tmux，经 SSH 的全屏、中文逐字节输入、返回与恢复通过；Vim 的实际 UTF-8 文件再次核对。
- `MYSSH_VERIFY_REAL_TERMINAL=1 npm run verify:tui-portable`：源仓库外、应用 PATH 无 Node，预览/SSH/SFTP/插件及真实 Vim/tmux 全部通过。
  macOS arm64 本机单文件 134,193,504 字节，Node 22.22.1；最终发行平台体积以发布资产为准。
- Electron：实际 preload/IPC 的 SSH、多 Shell、SFTP、监控、服务发现通过。
- 精简 TUI 生产依赖审计 0 漏洞；直接 JSZip/xmldom（MIT）替代 TUI mammoth，42 个安装包，保留原始许可证；桌面依赖保持原解析路径。

截图为合成输入的真实 PTY 帧经 headless buffer 重建：[DOCX](../screenshots/08-tui-preview-docx.png)、
[PPTX](../screenshots/08-tui-preview-pptx.png)、[ICO](../screenshots/08-tui-preview-ico.png)、[TIFF](../screenshots/08-tui-preview-tiff.png)。
不是 Windows 字体/输入法的人工观察结果。

## 远端与剩余条件

Windows WSL1 的 ConPTY 源码/单文件链和三平台最终 CI 作为 PR #36 / Release 的门禁，公开状态与报告以该 PR/Release 为准。
首次 CI 的 Linux/macOS/数据库通过，Windows 真实发行版启动通过；验收先补全 ConPTY 所需的 Node 绝对路径，再以选中行及实际 Linux 提示符同步交接，避免命令提前被菜单输入消耗。
WSL 的 Ctrl+C 中断后继续输入也进入真实链，等待的宿主临时保护 SIGINT，退出时恢复。
WSL 根文件系统来自 Alpine 3.23.6 的公开 x64 rootfs，SHA-256 固定，仅在 GitHub runner 导入按唯一名字清理。
实际远端程序在临时目录运行，不读取现有 shell/vim/tmux 配置，不连接业务服务器。

未提供具体第三方源码，故当前交付通用接入链和示例，不宣称适配所有 React 业务。
Office 精确排版/动画/图片、HEIC/HEIF 等仍通过下载；真实 WSL2、字体/IME/组合字符需本机人工验收。
有限自动范围与人工检查分别见 [验收表](../TUI-ACCEPTANCE.md)，不得以自动文字断言替代实际观察。
