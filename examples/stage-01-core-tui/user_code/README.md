# 从公开 API 连接、收取输出和读取文件

```bash
npm run example:core
```

输入：`hello\r`；输出：

```text
CORE_OK 你好
Hello SFTP
```

`main.mjs` 只导入 `out/tui/core.cjs` 这个公开构建入口和本地演示服务器：
`createCore → ssh.connect → events 收到 Shell ready → ssh.sendData → sftp.read → dispose`。
没有依赖 Electron、内部会话 map 或测试 mock。构建后的独立包入口为 `myssh-tui/core`。

在 `main.mjs` 的 `core.ssh.sendData` 处暂停，可看到 `sessionId` 和 `shellId`；继续后，
`ssh:output` 收到 `CORE_OK 你好`。SFTP 的返回结果为 `kind=text`、`truncated=false`。
正式核心断点映射见 [core README](../core/README.md)。
