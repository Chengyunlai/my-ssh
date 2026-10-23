# 使用者入口

先 `npm run build:tui`，再运行仓库脚本（临时解析已构建的公开包入口）：

```sh
node scripts/run-kubernetes-example.mjs /absolute/kubeconfig context namespace [service]
```

输出 `KUBERNETES_OK` 及服务/端口/候选数量。指定 Service 后建立回环转发并立即关闭；Redis 额外发送只读 PING，验证实际上游协议（允许 NOAUTH）。不读取 Secret、不执行 SQL、不修改资源。
无权限、认证失效都会失败，不返回成功空列表。配置凭据快照在 finally dispose 时删除。

追加 `--observe` 可通过同一个公开 Core 入口验证 Pod 指标与日志（只打印日志字节数，不打印业务内容）：`node scripts/run-kubernetes-example.mjs /absolute/kubeconfig context namespace service --observe`。指标无权限明确输出 METRICS_UNAVAILABLE，不伪造用量；日志错误直接失败。

桌面版现会加密记住导入内容与 Context/命名空间；Node example 本身仍只创建一次性的 Core 客户端，finally 释放。需要持久化的 Node 宿主自行提供加密存储，不要把 exportConfig 的结果打印或明文保存。
