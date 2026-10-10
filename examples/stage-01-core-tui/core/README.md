# 正式核心映射与断点

这里不复制生产源码。`server.mjs` 是仅监听 127.0.0.1 的虚拟演示服务，固定凭据
`demo / demo-fixture` 只用于本机自动验证，不连接真实服务器。

| 公开路径 | 正式源码符号 | 暂停观察 |
| --- | --- | --- |
| `createCore()` | `src/core/index.ts::createCore` | 独立 `CoreEventHub`，没有 WebContents |
| `ssh.connect(profile)` | `src/core/ssh.ts::connect` | client/session 映射、owner、ready=false |
| Shell 就绪事件 | `src/core/ssh.ts::setupShell` | stream 已入 map、监听器与 cwd 注入已完成 |
| `ssh.sendData` | `src/core/ssh.ts::sendData` | `hello\r` 写到对应 Shell |
| `sftp.read` | `src/core/sftp.ts::read` | 上限、截断标志、缓存、流式读取 |
| `dispose()` | `src/core/host.ts::CoreEventHub.dispose` | 仅释放当前 owner 的连接，清理采集/SFTP 状态 |

凭据业务规则在 `src/core/profiles.ts::ProfileStore.save`，落盘加密由宿主实现：
Electron 使用系统 safeStorage；TUI 使用 `src/tui/vault.ts::EncryptedVault`。
分支、基线和实际验证见 [实现记录](../../../docs/implementation/stage-01.md)；当前未提交。
