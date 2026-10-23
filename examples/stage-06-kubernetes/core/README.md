# Core 源码映射

公开 `myssh-tui/core::KubernetesClient` → importConfig → discover → forward → stop/dispose。

- `src/core/kubernetes.ts::importConfig`：kubectl config view 只读展开配置，拒绝 exec/auth-provider，写入 0700 临时目录内的 0600 快照，避免源文件变化引入命令执行。
- `parseKubernetesTargets`：按命名空间和 selector 关联 Pod，保留服务端口、状态和数据库候选；不把端口号当数据库身份。
- `forward`：动态本机端口，等待就绪后返回；Pod/进程退出标记 closed，不自动重放数据库操作。
- `src/main/kubernetes.ts`：文件选择与窗口所有权；共享 API 在 `src/shared/kubernetes.ts`，preload 只传 opaque ID。

断点使用上述符号。真实原始采集只保存在临时目录，不进仓库；测试 fixture 已白名单裁剪并替换资源标识。

可信 Node 宿主可用 `exportConfig(id)` 取得已检查快照并交给自己的加密存储，再用 `restoreConfig(snapshot)` 恢复；这些含凭据的原文方法不在 renderer API 中。`forgetConfig(id)` 撤销注册、删除运行副本并关闭该配置的全部通道。桌面加密与原子写入由 main/kubernetes-store.ts 拥有。
