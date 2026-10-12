# MySSH Example 索引

这里是项目唯一的示例根目录。先运行 `user_code/`，再读 `core/` 的正式源码映射。
公开 API 或调用路径变化时同步索引、架构和实现记录。

| 阶段 | 目标 | 运行命令 | 预期结果 | 设计 / 实现记录 |
| --- | --- | --- | --- | --- |
| [stage-01-core-tui](stage-01-core-tui/README.md) | 无 Electron 宿主调用核心 | `npm run example:core` | `CORE_OK 你好` / `Hello SFTP` | [设计](../docs/plans/core-tui.md) / [实现](../docs/implementation/stage-01.md) |

核心实现提交：`bb8cd721ea5e9f092345acbb1d419fe80bcabe7e`。三平台验收与 1.4.0 发布准备
复用该 Example，见 [stage-02](../docs/implementation/stage-02.md)；关联 [Issue #27](https://github.com/Chengyunlai/my-ssh/issues/27)。

[stage-03-tui-portable](stage-03-tui-portable/README.md)：公开 `--preview` 调用、免 Node 单文件分发，
先运行 `user_code/main.mjs`；设计见 [tui-followup](../docs/plans/tui-followup.md)，
实现见 [stage-03](../docs/implementation/stage-03.md)。

[stage-04-tui-plugins](stage-04-tui-plugins/README.md)：先 `npm run example:mysql`，看到
`MYSQL_OK 你好`；公共 Node MySQL 核心、声明式终端市场与官方适配，见
[stage-04](../docs/implementation/stage-04.md)。

[stage-05-tui-compatibility](stage-05-tui-compatibility/README.md)：`npm run example:tui-plugin`，
公开插件合同 → 描述/hash → 自建市场安装；扩展文档预览、真实 Vim/tmux/WSL 验收，
见 [stage-05](../docs/implementation/stage-05.md)。
