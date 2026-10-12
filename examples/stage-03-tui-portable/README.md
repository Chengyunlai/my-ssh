# stage-03：免 Node 程序与终端文件预览

先看 [user_code](user_code/README.md) 的 CLI 调用，再读 [核心映射](core/README.md)。
关联 [Issue #32](https://github.com/Chengyunlai/my-ssh/issues/32)、[设计](../../docs/plans/tui-followup.md)。

```bash
npm run build:tui
node examples/stage-03-tui-portable/user_code/main.mjs
```

在真实终端中看到 `图片 · 1 × 1` 和色块；Enter 返回，Enter 退出。不需要服务器或主密码。
传入绝对路径的单文件程序可复用同一调用：

```bash
node examples/stage-03-tui-portable/user_code/main.mjs /absolute/path/to/myssh
```

示例驱动脚本需要 Node，传入的 MySSH 程序自带运行时；使用者直接运行 `myssh --preview 文件` 不需要 Node。
实现记录见 [stage-03](../../docs/implementation/stage-03.md)。
