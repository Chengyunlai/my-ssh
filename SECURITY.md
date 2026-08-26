# 安全策略

MySSH 会处理服务器凭据、远程文件和可执行终端会话。请勿在公开 Issue、Discussion、日志或截图中
提交密码、私钥、连接地址、访问令牌及可利用细节。

## 支持范围

| 版本 | 安全更新 |
| --- | --- |
| 最新 1.x Release | 支持 |
| 更早版本 | 请先升级到最新版本后复现 |

## 报告漏洞

优先使用仓库 Security 页面中的 **Report a vulnerability** 私密报告入口：
<https://github.com/Chengyunlai/my-ssh/security/advisories/new>。

如果入口不可用，请创建一个不包含技术细节的 Issue，仅说明“需要与维护者私密联系安全问题”。
维护者建立私密沟通渠道前，不要公开复现步骤或利用代码。

报告建议包含：

- 受影响版本、操作系统和安装来源；
- 风险类型、影响范围和所需前置条件；
- 最小复现步骤或概念验证；
- 建议缓解方式（如有）；
- 是否已经向第三方披露。

维护者会尽快确认收到报告，在完成初步评估后协调修复与披露时间。请为用户升级预留合理窗口。

## 安全开发要求

- 凭据必须通过 Electron `safeStorage` 加密，禁止明文落盘或写入日志。
- Renderer 和外部插件只能通过 preload 暴露的最小 IPC API 访问高权限能力。
- 远程文件、插件 manifest、registry 和更新元数据均视为不可信输入，必须校验大小、类型、来源和错误边界。
- 新依赖需检查维护状态、许可证和已知漏洞；安全更新不能仅依赖自动化工具。
- 发布产物应逐步完成平台签名、notarization、校验和可追溯构建。

## 已处置的依赖风险

原生产依赖 `xlsx@0.18.5` 的 Prototype Pollution（[GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)）
和 ReDoS（[GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)）已迁移至 SheetJS
官方 CDN 的 `xlsx@0.20.3` 修复包。依赖 URL 和 SHA-512 integrity 固定在
`package-lock.json`；使用官方 npm registry 执行 `npm audit --omit=dev` 应不再报告这两个风险。

表格输入仍按不可信文件处理：Office 读取上限 10 MiB，SFTP 预览有超时，解析在独立 Worker 中
执行并带 10 秒 watchdog，解析只读取首个工作表的前 1000 行，渲染阶段限制列数/单元格数，
生成 HTML 也有上限，最终 HTML 继续通过 DOMPurify 净化。上述措施用于限制资源消耗，
不替代依赖升级。
