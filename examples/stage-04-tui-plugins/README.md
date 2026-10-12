# stage-04：终端插件与独立数据库核心

先运行 [user_code](user_code/README.md)，再读 [Core 映射](core/README.md)。
关联 [Issue #32](https://github.com/Chengyunlai/my-ssh/issues/32)、[设计](../../docs/plans/tui-followup.md)。

```bash
npm run example:mysql
```

预期：`MYSQL_OK 你好`。驱动脚本仅负责提供回环虚拟 MySQL 服务和端口；使用者代码通过
公开 `MysqlSession.connect → query → close` 调用相同 Node Core，不依赖 Electron 或浏览器代理。
独立 npm 包的对应入口为 `myssh-tui/mysql`。

`npm run verify:tui-plugins` 使用真实 PTY/ConPTY 操作市场安装、启停/卸载、MySQL 配置、
表结构/SQL/CSV/参数化行修改、命令发送和实时监控。`core/` 的协议服务/市场只提供合成输入，
不会操作真实业务数据；实际 MySQL 语义由独立 CI 容器进一步验证。

实现记录见 [stage-04](../../docs/implementation/stage-04.md)。
