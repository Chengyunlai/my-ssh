# MySSH TUI

在交互式终端中管理 SSH 连接与远程文件，不需要 Electron 或图形桌面。
npm 包运行环境：Node.js 22.13+；单文件程序自带运行时。Windows 建议 Windows Terminal。

## 本地运行

```bash
npm ci
npm run tui
```

仓库开发安装会包含桌面依赖；独立包包含 TUI、核心、SSH/xterm 与文件预览依赖，不包含 Electron/React。

## 构建独立安装包

```bash
npm run pack:tui
```

产物：`dist/myssh-tui-<版本>.tgz`。把这个文件交给使用者后，在 macOS、Windows、Linux
使用相同命令安装，不需要 Electron：

```bash
npm install -g ./myssh-tui-1.5.0.tgz
myssh
```

Release 工作流会附带同一份平台无关 tgz；从对应版本的 Release 下载后安装。
目前没有发布 npm 包，不要使用 `npx myssh-tui`。
更新时重新安装新版 tgz；Electron 的自动更新器只管理桌面应用。

## 免安装单文件程序

`npm run pack:tui-portable` 在 Node 22 LTS 下构建当前平台的程序与 `.sha256`。
Release 工作流从 1.5.0 起构建 macOS arm64、Windows x64 和 Linux x64 三种程序：

| 平台 | 文件 | 启动 |
| --- | --- | --- |
| macOS Apple Silicon | `myssh-tui-<版本>-darwin-arm64` | `chmod +x 文件名` 后 `./文件名` |
| Linux x64 | `myssh-tui-<版本>-linux-x64` | `chmod +x 文件名` 后 `./文件名` |
| Windows x64 | `myssh-tui-<版本>-win32-x64.exe` | 在终端中运行 `.\文件名.exe` |

用户无需安装 Node/npm/Electron。程序与 CPU/OS 对应，Linux 需满足 Node 22 的 glibc 2.28+ 要求。
macOS 使用 ad-hoc 签名，仍可能需要在系统中允许下载的程序运行；没有正式签名/公证。
程序启动将内嵌应用和依赖解压到随机临时目录（Unix 0700/0600），不把凭据写入该目录；
退出尝试清理，Windows 锁定的原生模块可能留待系统清理。更新时下载新文件替换旧文件。
现有 1.4.0 Release 只有 tgz；单文件产物属于后续版本，不能从 1.4.0 下载。

可用 `myssh --preview ./report.pdf` 独立预览本地文件，无需连接服务器或解锁 vault。

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
- 图片以 RGB 色块显示；PDF 分页图像和可选文字；DOCX 文字；XLS/XLSX 支持工作表切换。
  预览完整文件上限 5 MiB、图片 12 MP、Office ZIP 宣告展开量 32 MiB；Worker 的 JS 堆上限 256 MiB，15 秒超时，Ctrl+C 取消。
  图像不播放动画；Office 不保留复杂排版，不执行宏；PDF 不执行文档脚本。
  SVG 外部引用/脚本被拒绝；不支持的编码、HEIC/HEIF、旧版 DOC 和普通二进制仍可下载。
  支持常见 PNG/JPEG/GIF/WebP/BMP/SVG/AVIF、TIFF 首图和含 PNG 的 ICO；格式变体取决于解码器。
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
两端共用核心规则，各自使用适合宿主的存储方式。
终端市场只加载独立声明式入口，React 页面仍供桌面使用；TUI 不需要 Companion Runtime。

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
`npm run verify:tui` 需要 Python 3，使用 macOS/Linux PTY 或 Windows 10 1809+ ConPTY
自动验证键盘操作、配置 CRUD、多 Shell、文件预览/编辑、上传下载及递归删除。
验证仅使用本地虚拟 SSH 服务与临时文件。CI 三平台矩阵覆盖构建、独立安装与终端测试，
`npm run verify:tui-portable` 还会把程序复制出仓库，移除应用 PATH 中的 Node，验证完整 SSH/SFTP 与 PNG/PDF/XLSX/DOCX 预览。
统一 gate 保留原分支保护检查名称；Windows Terminal 的字体与 IME 体验仍须人工确认。
Shell 屏幕恢复依赖 xterm SerializeAddon；[上游说明](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-serialize)
将其标为实验性能力，复杂远端终端应用仍需要跨终端实测。

`npm run verify:desktop-core` 在图形桌面环境验证真实 Electron preload/IPC，使用独立临时数据目录。

## 终端插件（1.5.0+）

「插件」→「插件市场」→ 安装 → 启用 → 打开。官方市场与桌面共用地址，终端入口独立校验。
未提供终端入口的第三方插件会显示「尚无终端入口」，不会静默当作已适配。
安装默认停用；可更新、启停、卸载；损坏插件可在界面中移除/重新安装。

| 官方插件 | 终端能力 |
| --- | --- |
| 命令手册 1.2.0 | 原有 100 条命令搜索、查看、编辑并发送到所选 SSH Shell；由用户按 Enter 执行 |
| 服务器监控 0.2.0 | 3 秒采样、CPU/内存趋势、网络速率、磁盘与负载；可滚动，退出后停止调度 |
| MySQL 管理器 1.2.0 | 加密连接 CRUD、严格 TLS 可选、库表/结构/索引/建表 SQL、分页、SQL/编辑器/历史、排序/CSV、参数化行新增/修改/删除 |
| WSL 1.1.0 | Windows 实际发行版列表与交互终端；需本机已安装 WSL/发行版，输入 exit 返回 |

MySQL 配置与 30 条最近查询存于独立的 databases.vault.json，使用与 SSH vault 相同主密码、独立盐和用途绑定。
不读取桌面 localStorage，不要求代理服务或额外 Node。TLS 验证服务器证书，私有 CA 可使用 Node 的 NODE_EXTRA_CA_CERTS。
默认 SQL 单次最多 64 KiB、15 秒，结果最多 1000 行/100 列/2 MiB，长字段也会截断并明确标记。
表浏览每页 100 行，含主键时按主键排序；无完整主键或结果截断时不允许行修改，仍可执行明确 SQL。
修改前显示 SQL 与参数并确认，不自动回滚或重试；超时后需检查服务器结果。
CSV 只导出当前结果，危险公式前缀转为文字；SQL 编辑高亮与补全由配置的本地编辑器提供。

也可 `myssh --install-plugin command-book` 无交互安装；`--registry` 指定自建市场。
网络请求支持 HTTP_PROXY/HTTPS_PROXY/NO_PROXY，回环服务始终直连；退出会取消下载。

公开数据库 API：`myssh-tui/mysql` 的 MysqlSession.connect/query/executeMutation/close。
`npm run example:mysql` 提供最短公共调用；`npm run verify:tui-plugins` 验证市场与真实键盘链路。
