# 真实核心与宿主映射

- `src/core/mysql.ts::MysqlSession`：认证、TLS、流式结果上限、超时与连接生命周期；
  executeMutation 的值用服务器 prepared statement，不依赖 SQL 模式的字符串转义。
- `src/shared/tui-plugin.ts::validateTuiPlugin`：声明式终端贡献合同；没有 React/JS 执行入口。
- `src/tui/plugin-market.ts::TerminalPluginMarket`：协议/来源、大小、兼容性、SHA-256、安装状态。
- `src/tui/plugin-ui.ts::TerminalPluginsUI`：安装/更新/启停/卸载与能力入口。
- `src/tui/mysql-workspace.ts::MysqlWorkspace`：加密配置/历史、库表/行操作、当前结果 CSV。
- `src/tui/app.ts::commands`：用户选择的目录命令只发送文字，由用户在 SSH Shell 按 Enter。
- `src/tui/monitor-view.ts::showLiveMonitor`：共享 Core 采集，终端趋势/速率；隐藏后停止调度。

`mysql-server.mjs`/`registry.mjs` 是合成输入设施，不复制生产 Core。MySQL fixture 的私有
packet writer 仅用于模拟 wire protocol，不是使用者 API。真实数据库语义见
`scripts/verify-mysql-real.mjs` 和 CI 的临时 MySQL 容器。

观察路径：公开 MysqlSession → 真实 TCP 握手 → query/executeMutation 的列/行或 affectedRows → user_code 输出。
终端路径：市场 JSON → validateTuiPlugin → 宿主已知能力 → Core 调用 → TerminalUI。
