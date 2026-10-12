# 正式核心映射

不复制生产实现；`user_code/main.mjs` 的公开 CLI 进入以下稳定符号：

1. `src/tui/index.ts::main`：接收 `--preview`，检查大小，不解锁 vault。
2. `src/tui/preview.ts::runPreview`：创建有限时/JS 堆限制的 Worker，观察请求与取消。
3. `src/tui/preview-render.ts::renderPreview`：格式解析、PDF 页码、Office 工作表或图片像素。
4. `src/tui/preview-format.ts::colorBlocks`：像素产生受信 ANSI 色块；观察生成 lines。
5. `src/tui/ui.ts::TerminalUI.image`：输出终端画面并处理返回。

单文件启动路径：`scripts/sea-launcher.cjs` 的 entries 展开 → createRequire → 相同 main。
预览依赖属于终端宿主，Core 不依赖 Canvas、DOM 或这些解析器。
