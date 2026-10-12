# 同一份 Core 支持独立 Node 宿主

先运行 [user_code](user_code/README.md)：`npm run example:core`。
它导入公开构建入口，启动本地回环虚拟 SSH 服务，发送 `hello`，得到 `CORE_OK 你好`，
再读取 `/home/demo/hello.txt` 得到 `Hello SFTP`。不需要 Electron 或真实服务器凭据。

[core](core/README.md) 解释正式源码及关键断点；`core/server.mjs` 只提供虚拟 SSH / SFTP
数据，监控和服务发现使用固定演示输出，不执行本机系统命令。该示例验证独立宿主，不验证真实
Linux 主机采集或终端界面的外部 React 插件。

关联：[设计记录](../../docs/plans/core-tui.md) / [实现与验证记录](../../docs/implementation/stage-01.md)。
当前分支 `codex/feat/core-tui`，未提交。
