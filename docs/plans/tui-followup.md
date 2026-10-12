# 终端能力补齐与免 Node 分发

关联 [Issue #32](https://github.com/Chengyunlai/my-ssh/issues/32)。基线 master
`b414855dd7078639ad61fa40f5c4e6394c128689`，开始时工作区干净。

用户已授权继续实现。单个执行者负责 `src/tui/`、`scripts/`、CI/发布、依赖、文档和
`examples/stage-03-tui-portable/`；Core 与桌面 IPC 保持原接口。

stage-03 验收：单文件程序携带 Node 和所有运行依赖，无 node/npm 的环境仍可使用 SSH/SFTP；
三平台 PTY/ConPTY 验证；终端内图片色块、PDF 分页图像/文字、DOCX 文本和 XLS/XLSX 表格；
不打开浏览器，不执行文档脚本、宏或外链。5 MiB 输入、12 MP 图片、限时 Worker、分页输出。
恶意格式、截断文件、终端控制字符必须有失败路径测试。

Node 22 SEA 内嵌 Brotli 压缩的应用文件与原生解码依赖，启动解压到权限受限的随机临时目录，
退出清理。Windows 原生模块可能仍被 OS 锁定，清理采用尽力而为，不缓存凭据。
每个 OS/CPU 原生构建，Mac ad-hoc 签名。免安装不等于通用跨架构或正式签名。
PDF.js/Skia 用于 PDF 图像；现有 mammoth/SheetJS 用于 Office；原生依赖增加包体。

```mermaid
flowchart TB
  B[各平台 Node 22 + 安装后的 TUI 依赖] --> S[SEA 单文件 + 校验和]
  S --> T[临时目录内应用与依赖]
  T --> U[TUI]
  U --> C[共享 Core SSH/SFTP]
  U --> W[有限时/内存的预览 Worker]
  W --> P[图片/PDF 色块与文档文字]
```

图型：发行与预览边界；Mermaid D0，未连接 draw.io。

示例主线：`myssh --preview <本地文件>` 是公开入口，复用远程预览器；
`examples/stage-03-tui-portable/user_code/main.mjs` 生成虚拟 PNG/PDF/XLSX/DOCX 输入并调用入口。
`core/README.md` 导航真实实现，断点为 renderPreview、runPreview、SEA 文件展开。
验证：make check、独立 npm 包、npm run verify:tui-portable、真实三平台 CI。
记录：docs/implementation/stage-03.md。

stage-04 仍是本需求的一部分：终端插件合同、官方插件适配和市场入口。
React DOM 插件需要另一个终端入口，不能将未适配项算作完成。本阶段不提前关闭 Issue。
