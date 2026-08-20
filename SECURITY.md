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

## 已知依赖风险

截至 2026-08-20，生产依赖 `xlsx@0.18.5` 存在 1 个 **high** 级风险，涉及原型污染
（[GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6)）和正则表达式拒绝服务
（[GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9)），npm 当前没有可用修复版本。

当前缓解措施是仅在用户主动预览远程表格时解析、限制读取大小、放入独立 Web Worker，并用
DOMPurify 净化生成的 HTML。这些措施**不代表漏洞已修复**，尤其不能完全消除恶意文件造成的资源耗尽。
在替换解析库或上游提供修复前，该风险保留在 `ROADMAP.md` 的 Now 阶段；CI 阻止新增 critical
生产依赖风险，并持续显示该 high 风险供人工审查。
