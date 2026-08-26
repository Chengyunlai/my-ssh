# 0004：固定使用官方 SheetJS 修复包并限制表格预览资源

- 状态：接受
- 日期：2026-08-22
- 相关 Issue：#1

## 背景

`xlsx@0.18.5` 受到 Prototype Pollution（GHSA-4r6h-8v6p-xvw6）和 ReDoS
（GHSA-5pgg-2g8v-p4x9）影响。npm registry 没有发布修复版本，但 SheetJS 官方 CDN
提供了包含修复的 0.20.3 包。远程表格仍属于不可信输入，升级依赖不能替代资源限制。

## 决定

- 依赖固定为 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`，由
  `package-lock.json` 固定 SHA-512 integrity。
- 保留 `.xls` / `.xlsx` 预览兼容性，不引入只支持 XLSX 的替代库。
- Office 文件读取上限为 10 MiB，SFTP 预览读取有 15 秒超时。
- Worker 解析有 10 秒 watchdog，并只读取首个工作表的前 1000 行；渲染阶段最多展示
  100 列、100,000 个单元格，生成 HTML 不超过 2 MiB。
- 超过上限的文件或表格显示部分预览/下载提示，不尝试解析完整不可信输入。
- 继续使用 DOMPurify 净化最终 HTML。

## 后果

修复包可以通过官方 npm audit，现有 SheetJS API 和 XLS 兼容性保持不变。依赖来源从 npm
registry 变为官方 CDN，必须保留锁文件 integrity 并在依赖升级时重新核对官方来源。
复杂或恶意 Office 文件会被截断或超时，预览完整性让位于 renderer 稳定性。迁移包相较旧版
体积变化由官方 CDN tarball 和锁文件完整性固定，发布构建应在产物检查中持续记录其体积，避免
以安全升级为由引入不必要的包膨胀。

## 备选方案

- `read-excel-file` 与 `exceljs` 只支持 XLSX，无法满足当前 XLS 预览兼容性。
- 继续使用 0.18.5 并仅依赖 Worker 隔离只能缓解资源耗尽，不能消除已知漏洞。
