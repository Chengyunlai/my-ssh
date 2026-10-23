# ADR 0007：Kubeconfig 集群发现与数据库协议分工

日期：2026-10-22。

背景：数据库运行在独立 Kubernetes 集群，用户通过 kubeconfig/K9s 访问，并不一定有集群节点 SSH。已有 MySQL 插件负责数据库协议，不能发现 Service 或管理 port-forward。

决定：独立 Core KubernetesClient 使用本机 kubectl，Main 管理原生文件选择与窗口所有权，renderer 显示安全资源摘要；MySQL 插件使用受控 API 获取目标并申请自己的临时通道。保留现有 Companion Runtime，不将集群凭据交给它。不自动读取 Secret、不修改 workload、不修改用户全局 context、不执行凭据插件。

后果：依赖用户安装 kubectl；CLI 版本、连接失败与 Pod 重建需显式错误处理。kubeconfig 的运行副本使用受保护的临时快照，桌面宿主使用 safeStorage 加密保存导入内容与选择，重启可恢复；轮换需重新导入更新，用户可手动清理，凭据不进入 renderer。PostgreSQL/Redis 可发现、转发，数据管理需另行接入客户端。桌面和外部插件需分别发布；本次不发布。使用临时回环端口时，数据库 TLS 的服务名验证需要未来单独适配，不能通过关闭证书验证绕过。

验证：真实测试集群的 namespace 级发现与 Redis PING；公开 Node example；真实 Electron preload/IPC + 本地 Kubernetes API fixture；Core 行为回归测试。
