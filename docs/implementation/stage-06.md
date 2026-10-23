# stage-06：Kubeconfig 集群发现与数据库通道

日期：2026-10-22。工作区开始时干净；未提交、未推送、未发布。
核心分支 `master`，基线 `d241be4425d4dc04c93d655faaa0dab40f24f08d`；插件分支 `main`，基线 `17f872caa131041022e7f7d8540664ea0e959bf1`。

## 目标与范围

通过独立 kubeconfig 发现 Service/Pod，并通过宿主建立本机通道；复用 MySQL 管理器的数据浏览与 SQL 功能。公司测试环境和个人 Rancher 环境是两个独立环境，分别取证，不互相推断。

已实现：

- Core `KubernetesClient` 的导入、命名空间级发现、Service/Pod 归约、数据库候选、回环转发、状态与清理。
- Main 原生文件选择、按窗口隔离注册；shared/preload 最小 API；桌面独立面板不要求 SSH。
- 插件仓库 MySQL 管理器 1.3.0 的 Kubernetes 来源；按连接申请独立通道、失败/断开/卸载清理、进程结束提示，不重放 SQL。新建 Kubernetes 连接的密码仅存本次内存。
- 公开 Core example、脱敏真实输出回归、Electron 集成验证、ADR、README 与插件合同。

不包含 TUI 菜单入口、集群 workload 修改、读取 Secret、可执行认证插件、PostgreSQL/Redis 数据编辑器、自动 SQL 重试或发布。手动地址 MySQL 连接的历史存储方式本次不迁移。

## 实际环境取证

- 从用户 `k9t` 别名确认其使用测试 kubeconfig 和指定命名空间；没有访问生产 context。
- 公司测试命名空间：27 个 Service/Pod 资源；归约得到 12 个 Service、16 个 TCP 服务端口、2 个 Redis 目标。全局资源列举被 RBAC 拒绝，命名空间级发现与 pods/portforward 可用。
- 通过公开 Core 入口真实建立 Redis Service 转发，向数据库发送只读 PING，收到 Redis 协议响应，关闭转发并确认列表归零。没有执行 SQL 或修改集群对象。
- 个人服务器：PEM 仅交给 SSH 客户端认证，不读取私钥内容；确认 Rancher 运行及 local 集群，采集 22 个 Service/Pod 资源，发现 PostgreSQL 和 Redis。此处验证的是 SSH 可观察资源，不冒充 kubeconfig 路径端到端验证。
- 原始输出只临时保存；提交用 fixture 按白名单裁剪并替换 namespace/name/label/image 标识，不含环境变量、地址、凭据或真实服务器信息。检查了换行与控制字节；fixture 保留 Running/Pending、缺少 selector、多个端口和就绪状态差异。

## 验证

- `make check`：lint、Node/Web 类型检查、41 个测试文件 / 315 项测试及桌面/TUI 构建通过。
- `node scripts/run-kubernetes-example.mjs <absolute-kubeconfig> <context> <namespace> <redis-service>`：`KUBERNETES_OK`、`FORWARD_OK`、`REDIS_PROTOCOL_OK`、`FORWARD_CLEANED true`。
- `node_modules/.bin/electron scripts/verify-kubernetes.cjs <optional-screenshot.png>`：使用本地 Kubernetes API fixture，但执行真实 kubectl、文件选择、preload/IPC 与 renderer；验证 15 行资源、RBAC 错误和跨窗口所有权拒绝。截图人工检查后，改为复用宿主按钮样式，并将已识别数据库排在前面。
- 插件仓库 `npm run typecheck && npm test && npm run build`：通过，包含 21 项检查。
- 两个仓库 `git diff --check`：通过。

## 文件与职责

- `src/core/kubernetes.ts`、`kubernetes.test.ts`、`fixtures/kubernetes-resources.json`：采集、归约、进程生命周期与回归；`src/core/index.ts`：公开入口。
- `src/shared/kubernetes.ts`、`types.ts`、`src/preload/index.ts`、`src/main/kubernetes.ts`、`src/main/index.ts`：合同与 Electron 适配。
- `src/renderer/src/plugins/kubernetes/`：桌面独立面板；`examples/stage-06-kubernetes/`、两个验证脚本：使用与证据。
- 插件仓库 `src/mysql-manager/` 的连接表单、客户端类型、工作台生命周期、验证函数、版本/文档及 `src/global.d.ts`、测试脚本：复用既有数据库工作台。

## 使用与后续

运行开发版，在 Kubernetes 面板导入测试 kubeconfig，选择测试 context 并填写自己有权限的命名空间。可建立手动转发，使用显示的地址连接对应数据库客户端。

新版 MySQL 插件尚未发布，已安装市场版本不会自动获得修改。本地预览可以构建插件仓库，把其 dist/registry.json 作为 file:// 市场安装（没有官方 runtime 权限）；按插件 README 启动本机开发代理，在连接表单填写回环代理地址。正式使用仍推荐官方发布的按需 Companion Runtime，不降低市场信任校验来让本地产物冒充官方。

公司测试命名空间没有验证到可用 MySQL 实例，因此真实 K8s → MySQL 登录/SQL 尚未验证；Redis 通道及 MySQL 插件类型/构建/兼容校验已完成。下一步可用专门的 MySQL 测试实例补全 SQL 链路验证。凭据轮换需重新导入；配置内容变更会清除旧目标并关闭相关通道。应用重启后选择已保存配置，再发现服务；凭据更新需重新导入。

2026-10-22 本地测试修订：导入 kubeconfig 的原生文件选择器默认目录改为用户的 `~/.kube`，并显示隐藏文件。Electron 集成验证断言 defaultPath 和 showHiddenFiles；不修改 kubeconfig 内容。

## Kubernetes 面板设计修订（2026-10-22）

目标：让用户快速定位数据库并建立转发，减少密集 Pod 文本与松散配置项的阅读负担。仅修改 Kubernetes 展示层及桌面验证脚本。

沿用宿主暗色 token、按钮与字体：配置栏集中对齐；数据库标签与服务名称形成主次；命名空间和端口名降为次级文字；Pod 默认显示就绪数量，使用原生 details 展开名称与状态。新增数据库筛选和即时搜索；保留每个服务端口各自转发的行为。转发状态集中到连接通道区，错误、加载、未导入、查询为空及搜索无匹配分别提示。

QA：make check 通过（315 项测试）；真实 Electron + 本地脱敏 Kubernetes API fixture 验证配置导入、资源列表、数据库筛选、搜索无匹配与恢复、Pod 展开，以及 860px 窗口无页面级横向溢出。表格在窄窗口内横向滚动。检查 1180px 和 860px 截图后，为数据库标签增加截断和完整标题，避免窄列挤入端口列。截图使用脱敏 fixture，不代表连接真实公司的画面。未验证读屏或触屏。

## Pod 资源监控与日志查询（2026-10-22）

范围：展开服务关联的 Pod 后可打开监控与日志。Core 新增 metrics/logs，共享合同与 preload/Main 同步；KubernetesPodInspector 展示单 Pod 各容器 CPU/内存用量和采样时间，支持容器、最近时间、行数、previous、已加载日志关键词筛选，以及可选 10 秒快照刷新。app 面板新增 active 属性，隐藏后暂停刷新，关闭后忽略迟到响应；关闭详情恢复入口焦点。

安全边界：只允许访问已发现目标内的 Pod/容器；不接受任意命令、API 路径或无限日志参数。日志限 256 KiB，查询限时 20 秒，窗口同时最多 4 项，纯文本渲染、不存磁盘、不写业务日志到宿主日志。查询失败清空结果并关闭自动刷新；无权限/无指标接口不伪装为零用量。

真实测试环境：pods/log 可读；通过公开 KubernetesClient 对应用 Pod 查询，实际收到非空日志（验证仅输出字节数/行数，不展示业务内容）。Redis 最近时间段可返回正常空日志。单 Pod Metrics API 返回 Forbidden；个人 Rancher 的 Metrics API 返回 NotFound。没有安装 Metrics Server 或修改任何 RBAC。成功指标数据仅通过基于官方 Metrics API 合同的本地测试响应验证，不冒充真实指标采集成功。

验证：make check 通过；新增指标单位换算、坏数据、非法 Pod/容器、日志范围和 RBAC 错误回归。真实 Electron + 本地 API fixture 验证监控查询、日志查询及恶意 HTML 日志不执行；检查日志界面截图。公共示例增加 --observe；真实日志只打印字节数。

## 加密记忆已导入配置与手动清理（2026-10-22）

用户目标：再次进入面板或重启后无需重新选择原始文件，保留多个配置及各自 Context/命名空间，并能主动清理。

实现：Core 新增可信 Node 快照 export/restore/forget；Main 独立 KubernetesConfigStore 原子加密保存到 userData/kubernetes-configs.enc，不把原文/凭据交给 renderer，不降级明文。同一原路径再次导入更新现有条目，选择器切换已存配置；Context 改变、命名空间失焦或查询时保存选择。手动移除单条/清空全部均提供界面确认，关闭该配置通道并删除运行副本，原始文件保留。源文件删除后仍能恢复内容；证书/tokenFile 等外部引用仍需要其所指资源存在。恢复后不自动开启转发或重放 SQL，不缓存业务日志/指标。

边界：最多 32 条、序列化内容 8 MiB，运行注册按窗口隔离。系统加密不可用或数据损坏时明确报错并保留原记录；清空可解除损坏状态。删除配置同时撤销进行中的旧导入；旧查询不能重新注册已移除配置。不会自动补装插件或修改集群权限。

验证：加密存储单测覆盖新实例恢复、去重更新、选择保留、metadata 无原文、文件权限、移除与清空、损坏不覆盖、无加密时拒绝保存；Core 覆盖恢复时拒绝 exec、临时文件清理、资源消失后仍关闭通道。桌面验证用临时配置和本地 API，删除原文件后创建新窗口恢复，再验证多配置切换及界面移除/清空；未操作真实用户配置的清理功能。

### Pod 详情交互优化（2026-10-22）

目标：排障时直接进入监控或日志，保留服务列表位置，避免展开表格后再跳到页面上方。
改动仅涉及 Kubernetes renderer、桌面验收脚本和本文；沿用已有 typed IPC，无新增依赖。
服务运行状态旁提供「监控」「日志」入口；详情采用原生 modal dialog，左侧 Pod 列表，
右侧当前 Pod、内容切换、查询条件及结果。打开及切换条件自动查询，优先选择就绪 Pod；
手动刷新与可选 10 秒刷新保留。关闭或 Escape 返回列表并恢复入口焦点，日志使用独立滚动区域。
异步请求按当前选择校验，离开或切换后忽略旧结果；查询失败显示权限/指标服务说明。

验证：make check（42 个测试文件、324 项测试）；真实 Electron + 本机 Kubernetes fixture
验证直接入口自动加载、监控/日志切换、关闭/Escape 焦点恢复、860px 详情无横向溢出、
日志脚本内容保持纯文本，并回归加密配置恢复/移除/清空。已检查宽屏和窄屏截图。
真实公司集群指标权限仍受 RBAC 限制，本轮 UI 验收使用 fixture，并未证明真实集群指标可读。
基线 d241be4；保持当前分支与未提交状态，未提交或推送。
