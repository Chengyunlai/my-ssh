# 终端插件与 Node MySQL 核心

- Issue：[#32](https://github.com/Chengyunlai/my-ssh/issues/32)；[设计](../plans/tui-followup.md)。
- 分支：`codex/feat/tui-plugins`，基于 stage-03 与 master 合入 `a4e0dcaac108bfb0f4ce5855df5e0d8a291acf62`。
- 市场仓库 C1：`0d1a0cb009d7643ce8f8d29913bb89a4342e1712`，`feat(tui): 为官方插件发布声明式终端入口`；
  [PR #12](https://github.com/Chengyunlai/my-ssh-plug/pull/12) 已合入，merge `17f872caa131041022e7f7d8540664ea0e959bf1`。
- 记录语言中文。主仓库实现 C1：`173f305c5b3e9dec41c5d5e35ea10f439c980e32`，
  `feat(tui): 接入终端插件市场与 MySQL 工作台`；C2 不自引用。
- 状态：本地实现/验证通过；市场已部署；主仓库新增三平台与真实 MySQL CI 待运行，1.5.0 尚未发布。
- Example：先 `npm run example:mysql`，见 [user_code](../../examples/stage-04-tui-plugins/user_code/README.md)，
  再看 [Core 映射](../../examples/stage-04-tui-plugins/core/README.md)。

## 用户可见能力

终端市场可安装/更新/启用/停用/卸载声明式入口，不执行外部 React/JS。
四个官方插件提供独立 terminal.json：命令手册 1.2.0、MySQL 1.2.0、监控 0.2.0、WSL 1.1.0。
命令手册继续从市场仓库原 data.ts 生成 100 条命令；选择后只发送文字，由用户在 SSH Shell 按 Enter。
监控每 3 秒串行采样、趋势/速率/滚动；离开停止调度，复用 SSH Core 采集与节流。

MySQL：加密连接 CRUD 与 30 条历史、TLS 可选严格验证、数据库/表/结构/索引/建表 SQL、
100 行分页、当前结果排序/CSV、SQL/本地编辑器、参数化行新增/修改/删除。
公共 `myssh-tui/mysql` 提供 MysqlSession.connect/query/executeMutation/close；独立于 SSH 事件域，调用者 close。
SQL 编辑高亮/补全由配置的编辑器提供；TUI 的交互形式与桌面不同，没有直接渲染 React 面板。
WSL 读取 Windows 的真实发行版列表并交接终端（exit 返回）；原桌面 WSL 页面仍是模拟实现。

## 安全与职责

- shared/tui-plugin：版本化纯数据合同、种类、长度、控制字节；无 Node/DOM。
- TUI market：同源与相对路径、协议、大小、版本/平台、终端独立 SHA-256；官方徽章仅信任固定 URL。
  默认停用，坏文件可移除/重装；下载取消/总超时，读取代理环境变量，回环直连。
- Core mysql：认证/TLS、结果流式上限、超时/销毁；行修改使用服务器参数，不拼接用户值，
  支持 NO_BACKSLASH_ESCAPES。任意 SQL 执行需要界面预览与确认，不自动回滚/重试。
- TUI vault：SSH 格式兼容 1.4.0；数据库独立盐/用途 AAD，损坏不阻止 SSH 解锁；密码与历史不明文落盘。
- 行结果/长字段截断时禁止 GUI 写回；无完整主键仅查看；CSV 把危险公式前缀变为文字。
- mysql2/undici（MIT）是新增终端运行依赖，根项目为 devDependencies，桌面输出主包体保持原值；
  mysql2 为纯 JS 协议驱动，undici 提供受控下载及代理/取消；lockfile 随改动提交。

## 可回放路径

user_code 公共导入 → MysqlSession.connect → TCP 握手 → query → columns/rows → MYSQL_OK 你好 → close。
市场 → validateTuiPlugin → 已知宿主能力 → Core SSH/MySQL → TerminalUI。
断点：MysqlSession.connect、query/executeMutation、TerminalPluginMarket.install、MysqlWorkspace.mutate、
TuiApp.commands、showLiveMonitor。MySQL packet writer 只在合成服务中，不是公共 API。

## 本地验证

- `make check`：lint/Node+web 类型/测试/桌面与 TUI 构建通过；34 文件 / 285 测试通过。
- `npm run example:mysql`：真实回环 TCP，输出 MYSQL_OK 你好。
- `npm run verify:tui-plugins` 及 MYSSH_VERIFY_SCREEN=1：市场安装/启停/卸载、加密 DB 连接/历史、
  库表结构、SQL/CSV、服务器参数化行修改、命令发送、实时监控通过。
- `npm run verify:tui-portable`：在源仓库外、应用 PATH 无 node/npm 的同一二进制上，
  预览、SSH/SFTP 和终端插件链全部通过；macOS arm64 实测约 134.4 MB，依赖变化后以最终产物为准。
- 独立 tgz 可从 CJS/ESM/TS 消费 Core，并通过 myssh-tui/mysql 调用实际 TCP 会话；无 Electron/React。
- 单元覆盖握手/错误口令/TLS 拒绝回退、参数化值/NULL/长字段/1000 行上限、vault 用途绑定，
  市场哈希/路径/格式/兼容/坏文件恢复/取消，CSV/排序、监控增量与 WSL 编码。
- 本机 Docker daemon 未运行，实际 MySQL 8.4 语义由 CI 临时容器验证：行 CRUD、中文/NULL、
  NO_BACKSLASH_ESCAPES、结构/索引、截断断线与重连；不触碰真实业务数据库。

市场 [CI 38209816359](https://github.com/Chengyunlai/my-ssh-plug/actions/runs/38209816359) 与
[Pages 38210123500](https://github.com/Chengyunlai/my-ssh-plug/actions/runs/38210123500) 通过。
已回读公开 registry，核对四个终端资源 SHA-256，当前 macOS 支持的三个插件通过公开
`--install-plugin` 安装，默认停用/官方标记正确。WSL 的真实发行版/交互取决于 Windows 本机安装，未声称在 macOS 验证 WSL。

截图为合成服务的真实终端帧：[SQL](../screenshots/07-tui-plugin-mysql-query.png)、
[结构](../screenshots/07-tui-plugin-mysql-schema.png)、[监控](../screenshots/07-tui-plugin-monitor-live.png)。

## 发布与剩余边界

1.5.0 组合 stage-03 与本阶段，三平台/真实数据库 CI 后合入，再 tag 构建精确 17 文件资产。
未发布前不能把本地单文件称为公开 Release。第三方 React 页面仍需终端入口；
复杂 Office 排版、HEIC/HEIF、无 PNG 的 ICO 等编码保留下载途径，字体/IME/复杂远端应用仍需真实终端体验验收。
Mermaid 见设计记录，D0，未连接 draw.io；新插件合同与示例导航已同步。

首次主仓库 [CI 38211693754](https://github.com/Chengyunlai/my-ssh/actions/runs/38211693754)：
三平台全部键盘/独立包/单文件链路通过；真实 MySQL 的建库返回 OK 状态包，驱动 fields 为 undefined，
暴露了查询处理遗漏无列结果。已允许空列并添加 wire-protocol DO/OK 回归，修正后重新验收。

CSV 对全角/空白/换行前缀也检查，使用引号内制表符保护电子表格查看；程序导入须保留该格式差异。
