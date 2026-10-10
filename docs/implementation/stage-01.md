# 共用 Core 与 TUI 实现记录

- 设计记录：[core-tui](../plans/core-tui.md)，本地设计记录，没有创建外部 Issue。
- Example：[公共调用入口](../../examples/stage-01-core-tui/user_code/README.md)，`npm run example:core`。
- 基线：`bbef9c0d5dc7ac9aa05acbaf404e8ff26889f83d`。
- 分支：`codex/feat/core-tui`；用户已授权提交并推送该分支，没有发布或创建 PR。
- 代码职责：`src/core/` Node 业务，`src/main/` Electron 适配，`src/tui/` 终端交互。

## 实际结果

Electron 主进程复用 Core；preload / renderer 的 API 合同保持兼容。TUI 具备连接配置、连接测试、
多会话 / 多 Shell、SFTP、文本预览编辑、监控、服务发现，退出释放当前宿主的连接。
图片 / PDF / Office 下载后本地查看，React 插件市场与 Companion Runtime 需要独立终端适配。

独立 `myssh-tui-1.3.5.tgz` 构建本体约 85 KB（运行依赖另计），要求 Node.js。
新 xterm 依赖是根项目开发依赖，生成的 TUI 包将其声明为运行依赖；Electron 打包排除 TUI 目录。
新增依赖用于保留每个 Shell 的 VT 屏幕状态，不增加网络、文件系统或凭据权限。

配置采用主密码 vault：scrypt / AES-256-GCM，错误口令和损坏文件不重置配置，原子替换权限为
0600 的文件。桌面系统加密文件不自动迁移。文件传输先写 0600 的临时文件，失败保留旧目标；覆盖保存 mode 和远端 owner/group，无法保留则失败，新远端文件沿用本地 POSIX 权限，Windows 来源默认 0644。

## 公开使用与关键断点

`user_code/main.mjs` 从公开 Core 构建入口连接本地演示服务，发送 `hello`，收到
`CORE_OK 你好`，再读取文件得到 `Hello SFTP`。演示服务不执行任意系统命令。
断点沿 `createCore → connect → setupShell → sendData → sftp.read → dispose`，
具体变量见 [core README](../../examples/stage-01-core-tui/core/README.md)。

## 验证

以下为实际已执行的证据：

- `npm test`：28 文件、258 测试通过；含本地 SSH/SFTP 集成、宿主隔离、凭据与失败传输回归。
- `npm run example:core`：输出 `CORE_OK 你好` 和 `Hello SFTP`。
- `npm run verify:tui`：macOS 真实 PTY 通过配置创建、认证测试、SSH、多 Shell 屏幕恢复、Ctrl+]、SFTP 预览、
  指标、服务发现、断开与正常退出；只使用回环虚拟服务器。
- `npm run verify:tui-package`：在临时目录独立安装，未安装 Electron / React，帮助、版本、
  公共 Core 的 CJS/ESM 导入、TypeScript 类型消费、真实 SSH/SFTP 调用与非 TTY 拒绝通过。
- `make check`：lint、Node / renderer 类型检查、258 测试、桌面与 TUI 构建通过。
- `npm run verify:desktop-core`：真实 Electron preload/IPC 的 SSH、多 Shell、SFTP、指标与服务发现通过。
- 生产依赖 audit high/critical 门禁通过，仍有 4 个既有 low/moderate 告警。

截图来自实际 PTY transcript，经 headless xterm 解析后渲染为 PNG；见
[终端](../screenshots/05-tui-shell.png) / [文件列表](../screenshots/05-tui-sftp.png)。

## 边界与后续验收

macOS 已实际运行。Windows/Linux 的完整交互尚未在本机执行；CI 已增加三平台矩阵，需提交后
取得结果。Windows Terminal 的键盘、编辑器与 Shell 恢复需要人工验收。真实 Linux 采集由已有
平台集成测试及采集 fixture 覆盖；本次 TUI 操作链用虚拟指标，不代表远端生产机实测。

并发编辑的检查与写回之间仍有竞争窗口，服务器不支持原子 rename 也是 SFTP 边界；写回前会绕过缓存重新读取
并比较文本，常规 rename 无法覆盖时返回失败并保留旧文件。网络中断可能留下远端临时文件，
清理尝试不会删除正式目标。

推广、npm 发布、免 Node 的单文件可执行版本、外部插件 TUI 适配不属于这次已验证交付。
图表仅为 Mermaid D0，没有连接或修改 draw.io。导航：README → ARCHITECTURE → examples → 本记录。
