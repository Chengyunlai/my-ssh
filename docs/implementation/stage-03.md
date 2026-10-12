# 终端文件预览与免 Node 单文件分发

- Issue：[#32](https://github.com/Chengyunlai/my-ssh/issues/32)。
- 分支：`codex/feat/tui-portable-preview`；基线 `b414855dd7078639ad61fa40f5c4e6394c128689`。
- 记录语言：中文。实现 commit（C1）：`37e64dd4d6ccb898449dc309d96357f45e05beea`，
  `feat(tui): 支持终端文件预览与免 Node 单文件分发`；记录 commit（C2）不自引用。
- Example：[user_code](../../examples/stage-03-tui-portable/user_code/README.md) 优先，
  再读 [核心映射](../../examples/stage-03-tui-portable/core/README.md)。
- 状态：本地与三平台 CI 通过，已合入 PR #33；尚未发布新的 Release。

## 用户可见结果

新增 `myssh --preview 文件` 和 SFTP 非文本预览。PNG/JPEG/GIF/WebP/BMP/SVG/AVIF 由 Canvas 解码，
TIFF 首图由 UTIF 解码，含 PNG 的 ICO 可查看；图像是 RGB 半格色块。
PDF 分页显示图像，也可查看当前页文字；DOCX 提取文字；XLS/XLSX 切换工作表。
没有图形桌面或本地 Office 应用也可查看内容，Office 复杂排版、动画与 HEIC/HEIF 未支持。
旧版二进制 DOC、无 PNG 的 ICO 与未知编码仍可下载；不能称所有媒体编码均已对齐。

`npm run pack:tui-portable` 用官方 Node 22 发行版构建当前 OS/CPU 的 SEA 单文件程序。
精简 TUI 依赖从仓库 lock 计算，平台 Canvas 原生模块一起嵌入；无需用户安装 Node/npm/Electron。
应用压缩资产展开到随机临时目录，Unix 0700/0600；凭据另存 vault。
许可证包含 Node 完整 LICENSE 与原始依赖许可证；macOS ad-hoc 签名，未做正式公证。

## 组装与规则所有者

CLI/远程 SFTP → showPreview → runPreview Worker → renderPreview → colorBlocks/文字净化 → TerminalUI。
输入最多 5 MiB，图片最多 12 MP；Office ZIP 的宣告展开量最多 32 MiB；
Worker JS 堆最多 256 MiB、15 秒超时、Ctrl+C 取消。JS 堆限制不是原生解码的 OS 内存硬限制。
PDF 不调用文档动作/脚本，Office 不执行宏，SVG 外部引用和脚本被拒绝；只传 bytes，不按文档 URL 加载文件。

SEA → 内置 fs/v8/zlib 展开可信构建资产 → createRequire 加载相同 TUI 入口。
发布矩阵增加三种单文件程序及 SHA-256，总资产合同 17 文件；校验和不匹配则拒绝发布。
Windows 原生模块可能在退出时仍锁定，临时目录清理为尽力而为，可能留待 OS 清理。

## 验证

- `make check`：lint、Node/web 类型检查、29 文件/269 测试、Electron/TUI 构建通过。
- `npm run verify:tui-package`：独立 tgz 安装，无 Electron/React，CJS/ESM/TS 公共 Core、真实 SSH/SFTP 通过。
- `npm run verify:tui-portable`：复制单文件程序到仓库外目录，应用 PATH 无 node/npm，
  实际 PNG 像素、PDF 分页/文字、XLSX 工作表、DOCX 中文预览和原有完整 PTY SSH/SFTP 操作链通过。
- `MYSSH_VERIFY_SCREEN=1 npm run verify:tui-portable`：同一链路在 VT 屏幕解析模式通过。
- 预览单元测试覆盖 RGB/透明度、像素拒绝、实际 PNG/PDF/TIFF/ICO、工作表、控制字符、
  畸形/超大文件、SVG 外部资源及 ZIP 展开量拒绝。
- 精简 TUI 的生产审计无 high/critical，mammoth 原有 CLI 依赖链仍有 3 项 moderate 报告。
- macOS arm64 单文件实测约 133.6 MB（含 Node 与原生解码器）；tgz 约 91 KB，依赖安装另计。

本地真实 PTY 帧生成截图：[PDF](../screenshots/06-tui-preview-pdf.png)、
[DOCX](../screenshots/06-tui-preview-docx.png)、[XLSX](../screenshots/06-tui-preview-xlsx.png)、
[PNG](../screenshots/06-tui-preview-png.png)；全部文档为合成夹具。

## 依赖及边界

Canvas（MIT）负责跨平台图像/PDF 光栅；PDF.js（Apache-2.0）负责 PDF 解析；
image-size（MIT）在解码前检查尺寸；UTIF（MIT）弥补 Canvas 的 TIFF 差异；postject（MIT）只用于构建 SEA。
复用已有 mammoth/SheetJS，新增项在根项目为 devDependencies，只进入 TUI 包。
Node 22 SEA 是活跃开发接口：[官方说明](https://nodejs.org/api/single-executable-applications.html)。
Canvas 与 PDF.js 使用方式参照各自 [Canvas](https://github.com/Brooooooklyn/canvas)、
[PDF.js](https://github.com/mozilla/pdf.js) 文档。

断点：main 的 previewFile 分支、runPreview 的 Worker、renderPreview 的当前页/工作表、
colorBlocks 的 lines、sea-launcher 的 entries。Mermaid 图见设计记录，D0，未连接 draw.io。

## 下一阶段

终端插件合同和官方插件适配仍在 Issue #32 内。1.4.0 Release 未被修改；
三平台新程序通过 CI 后，再组合后续版本发布，不能将本地二进制称为已公开发布。

首次三平台运行 [38206344205](https://github.com/Chengyunlai/my-ssh/actions/runs/38206344205)：
Linux/macOS 全链通过，Windows 发现 PDF.js 要求资源目录以 `/` 结尾，原 `path.sep` 为反斜杠。
已归一化为 Node filesystem 支持的正斜杠路径，补充 Windows/Unix 路径回归测试；修正后 [38206754774](https://github.com/Chengyunlai/my-ssh/actions/runs/38206754774) 全部通过。
合入 [PR #33](https://github.com/Chengyunlai/my-ssh/pull/33)，merge `a4e0dcaac108bfb0f4ce5855df5e0d8a291acf62`。
