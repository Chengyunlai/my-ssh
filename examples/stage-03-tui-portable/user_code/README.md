# 使用者入口

`main.mjs` 写入虚拟 PNG，通过公开 `myssh --preview <文件>` 查看。不导入内部模块。
运行命令见上级 README；输入是一个 PNG 文件，输出是终端里的 RGB 色块，预览不触碰凭据。

调试先在 `src/tui/index.ts::main` 的 previewFile 分支观察文件参数，再进入
`src/tui/preview.ts::showPreview`；Worker 的输入包含 bytes、page、columns、rows。
免 Node 验证入口 `npm run verify:tui-portable` 会移除应用 PATH 的 node/npm，验证实际程序，
而不是把示例驱动脚本是否依赖 Node 当作免 Node 证据。

实现基线 C1：`37e64dd4d6ccb898449dc309d96357f45e05beea`；设计/实现记录通过上级 README 导航。
