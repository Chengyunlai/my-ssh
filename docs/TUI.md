# MySSH TUI

在交互式终端中管理 SSH 连接与远程文件，不需要 Electron 或图形桌面。
运行环境：Node.js `^20.19.0 || >=22.12.0`；Windows 建议 Windows Terminal。

## 本地运行

```bash
npm ci
npm run tui
```

仓库开发安装会包含桌面依赖；提供给用户的独立包只包含 TUI、核心和 ssh2 / xterm 的 Node 模块。

## 构建独立安装包

```bash
npm run pack:tui
```

产物：`dist/myssh-tui-<版本>.tgz`。把这个文件交给使用者后，在 macOS、Windows、Linux
使用相同命令安装，不需要 Electron：

```bash
npm install -g --omit=optional ./myssh-tui-1.3.5.tgz
myssh
```

Release 工作流会附带同一份平台无关 tgz，目前该产物尚未发布。
目前没有发布 npm 包，不要使用 `npx myssh-tui`；没有在本次变更中上传 Release。
更新时重新安装新版 tgz；Electron 的自动更新器只管理桌面应用。

## 操作

- ↑↓ 或 j/k 选择；Enter 确认；Esc 返回；`/` 搜索菜单；Ctrl+C 退出 TUI。
- 首次启动设置主密码（至少 8 字符）；以后用相同主密码解锁。SSH 密码和私钥口令掩码输入。
- 「服务器」支持连接增删改和连接测试；可同时打开多个 SSH 会话。
- SSH Shell 中 Ctrl+C 发给远端，**Ctrl+] 返回菜单**，不关闭会话。
- 「终端」可新建、进入、关闭同一连接下的独立 Shell；关闭最后一个 Shell 会断开会话。
- 「SFTP」浏览与跳转目录、上传下载、创建目录、递归删除、文本预览 / 编辑。
  覆盖及删除需要界面确认；临时传输文件以 0600 创建，新远端文件沿用本地 POSIX 权限，
  Windows 来源默认 0644，覆盖保留已有权限与 owner/group；文本超过 5 MiB 只读，预览界面最多显示 64 Ki 字符。
- 文本编辑读取完整允许范围，调用 `VISUAL` / `EDITOR`，默认 macOS/Linux 为 `vi`、Windows 为
  `notepad.exe`；编辑器退出后确认写回。GUI 编辑器须配置等待参数，例如 `EDITOR="code --wait"`。
- 图片、PDF、Office、二进制文件下载后由本地应用打开。
- 系统监控和服务发现复用桌面版的采集和解析规则。远端 Linux 支持采集；其他远端返回不支持。

## 数据与边界

TUI 使用独立 `profiles.vault.json`，scrypt 派生密钥、AES-256-GCM 验证加密完整性；
主密码不写入磁盘。忘记主密码不能恢复凭据。错误口令或损坏文件不会自动重置已有配置。

默认数据目录：

| 平台 | 目录 |
| --- | --- |
| macOS | `~/Library/Application Support/myssh-tui` |
| Windows | `%APPDATA%/myssh-tui` |
| Linux | `$XDG_CONFIG_HOME/myssh-tui` 或 `~/.config/myssh-tui` |

`MYSSH_TUI_HOME` 可指定其他目录。独立 vault 不自动迁移 Electron safeStorage 的配置；
两端共用核心规则，各自使用适合宿主的存储方式。已有 React 外部插件需要专门的 TUI 界面适配，
当前不会加载 React 插件、插件市场或 Companion Runtime。

每个 Shell 使用有上限的 headless xterm buffer 保存屏幕；后台输出只更新对应 buffer。
恢复前等待已排队输出并重新设置远端 PTY 尺寸；scrollback 上限为 1000 行。

## 核心公开 API

源码从 `src/core/index.ts` 导入；独立包从 `myssh-tui/core` 导入 `createCore` 和 `ProfileStore`。
`createCore()` 管理一个宿主事件域，dispose 关闭这个宿主的全部连接。
桌面仍只通过 preload 访问核心；renderer 禁止直接导入 Node 核心。

最短可运行示例见仓库 `examples/stage-01-core-tui/user_code/`。

## 开发验证

`make check` 包括桌面与 TUI 构建。`npm run example:core` 验证独立公共 API；
`npm run verify:tui-package` 在临时目录安装 tgz 并验证真实 SSH/SFTP 调用；
`npm run verify:tui` 需要 Unix PTY 和 Python 3，自动验证键盘操作（Windows 在终端中人工验证）。
CI 三平台矩阵覆盖构建与独立安装，Unix job 还执行 PTY 测试，统一 gate 保留原分支保护检查名称。
Shell 屏幕恢复依赖 xterm SerializeAddon；[上游说明](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-serialize)
将其标为实验性能力，复杂远端终端应用仍需要跨终端实测。

`npm run verify:desktop-core` 在图形桌面环境验证真实 Electron preload/IPC，使用独立临时数据目录。
