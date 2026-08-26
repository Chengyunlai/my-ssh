# MySSH 插件开发规范

插件是 MySSH 扩展功能的标准方式,分两类:

- **内置插件**:源码在核心仓库 `src/renderer/src/plugins/<id>/`,随应用打包分发,只能禁用、不可卸载
- **外部插件**:源码在独立市场仓库 `my-ssh-plug`,构建为 ESM bundle 发布,经自定义协议
  `myssh-plugin://` 运行时加载,可安装 / 更新 / 卸载。两者共享同一套清单字段与能力边界。

## 1. 清单字段

```ts
definePlugin({
  id: 'my-plugin',                  // kebab-case、全局唯一、一经发布不可更改
  name: '插件名',
  version: '1.0.0',                 // semver
  description: '一句话说明功能',
  author: 'MySSH',                  // 可选
  category: 'terminal',             // 分类 id(官方分类表,见 §5)
  minAppVersion: '0.1.0',           // 最低兼容 MySSH 版本(semver)
  maxAppVersion: '0.2.0',           // 可选:最高兼容 MySSH 版本
  platforms: ['win32'],             // 可选:支持的运行平台(win32/darwin/linux),缺省为全平台
  official: true,                   // 官方标记:内置可直接声明;外部插件以 registry 盖章为准
  builtin: true,                    // 内置插件标记(外部插件置 false)
  defaultEnabled: true,             // 首次启动默认状态,缺省为启用
  panel: {
    title: '标签标题',
    scope: 'session' | 'app',       // app:无需会话;session(默认):需已连接
    layout: 'standard' | 'workspace', // 内容区布局级别,缺省 standard
    Component: PanelComponent
  },
  widget: {
    placement: 'terminal-bottom',   // 终端底部的小型挂件条
    Component: WidgetComponent
  },
  runtime: {
    kind: 'node-companion-v1',
    entry: 'runtime/mysql-manager-proxy.cjs',
    sha256: '<runtime bundle sha256>',
    transport: 'websocket',
    lifecycle: 'on-demand'
  }
})
```

`panel` 与 `widget` 二选一或都提供:

- `panel`:主区域标签页(如文件传输),`scope: 'app'` 无需会话
- `widget`(当前仅 `terminal-bottom`):渲染在终端区域底部的一条轻量组件,接收
  `{ sessionId, profile }`,适合命令搜索条、状态提示等小功能

### 1.1 Companion Runtime（官方插件）

需要本地后台服务的官方插件可以声明 `runtime`，但不得在 renderer 中自行启动 Node、shell 或
固定端口。MySSH 核心会在插件首次调用 `runtime.getEndpoint()` 时：校验 runtime bundle 的
SHA-256、固定绑定 `127.0.0.1`、以 `port=0` 启动、生成临时 token，并把实际 WebSocket 地址
注入当前插件面板。插件只实现自己的业务协议和 UI。

当前契约只支持：

- `kind: node-companion-v1`：纯 JavaScript Node bundle，暂不允许原生 `.node` 依赖；
- `transport: websocket`；
- `lifecycle: on-demand`（首次使用启动，禁用/卸载/退出应用时停止）。

插件组件通过 props 使用宿主 capability：

```ts
function Panel({ runtime }: { runtime?: PluginRuntimeContext }) {
  const endpoint = await runtime?.getEndpoint()
  // endpoint.url 由宿主生成，不要自行拼接 host / port / token
}
```

第一阶段只允许 MySSH 官方固定 registry（`https://chengyunlai.github.io/my-ssh-plug/registry.json`）
盖章的官方插件启动 companion runtime。runtime bundle 与 renderer 入口分开下载、分别校验 hash；
插件不能自定义启动命令、环境变量、监听地址或端口。需要后台
服务的新插件必须先在核心仓库完成宿主契约 Issue/PR，再在插件仓库接入。

### 1.2 内容区、位置与布局约束

插件**不能自行决定 MySSH 外壳中的位置**。位置由清单能力和宿主插槽决定:

| 类型 | 宿主位置 | 面积上限 | 适用场景 |
| --- | --- | --- | --- |
| `panel.scope: 'session'` | 会话标签栏 → 内容区 | 占满宿主内容区,不覆盖顶栏/侧栏/状态栏 | 依赖 SSH 会话的文件、监控、运维工具 |
| `panel.scope: 'app'` | 应用标签栏 → 内容区 | 占满宿主内容区,不覆盖顶栏/侧栏/状态栏 | 独立于 SSH 会话的工作台,如 MySQL 管理器 |
| `widget.placement: 'terminal-bottom'` | 当前终端画布底部 | 只允许一条轻量横栏,高度建议不超过 40px | 命令搜索、状态提示、快捷操作 |

`panel` 由宿主包在 `.plugin-surface[data-plugin-id][data-plugin-layout]` 中。插件根节点必须
填满该 surface,但不得使用 `position: fixed`、修改 `body/#root`、创建跨越宿主的全屏 Portal,
或依赖宿主外部的 DOM 选择器。宿主会强制 `min-width: 0; min-height: 0; overflow: hidden`，
插件内部需要滚动时必须在自己的列表/编辑器区域设置 `overflow: auto`。

`layout` 只有两个级别，不允许插件自定义第三种布局:

- `standard`(默认):普通工具栏 + 内容列表/表单,适合轻量面板。外层留白由插件使用
  `--myssh-plugin-space-*` token 控制。
- `workspace`:重型工作台,允许在内容区内部组织侧栏、工具栏、标签页和结果区。插件仍不能
  伸出 surface；内部侧栏建议宽度 240–320px，最小窗口下应收缩到 200px 或提供自己的折叠。

以 `mysql-manager` 为例:它应声明 `panel.scope: 'app'` 与 `panel.layout: 'workspace'`，
内部的连接/对象树是插件自己的**内部侧栏**，不能把 MySSH 左侧服务器栏当成可重排区域，
也不能通过 CSS 把 MySQL 工作台提升到顶栏或状态栏。

### 1.3 SSH 系统指标宿主 API

需要展示当前服务器 CPU、内存、磁盘或网络指标的插件应声明
`panel.scope: 'session'`，在面板处于 active 状态时按约 3 秒间隔调用：

```ts
const result = await window.ssh.monitor.getSnapshot(sessionId)
if (result.ok) {
  // result.snapshot.cpu / memory / disks / network / uptimeSeconds
} else {
  // result.error.code: unsupported / timeout / rate-limited / ...
}
```

宿主只支持当前连接的 Linux 主机。采集使用独立 SSH exec 通道，不会把输出混入用户终端；插件
不能提交命令、环境变量、端口或凭据。单次采集有超时、输出上限和 session 级节流，同一 session
同时只允许一个请求；宿主还会校验 sessionId 属于当前 renderer 窗口。CPU 首次采样的 `usagePercent` 为 `null` 且 `sampleStatus` 为
`insufficient-data`；网络接口返回累计收发字节，速率由插件根据两次快照计算。

插件必须在面板隐藏或卸载时停止轮询，并将 `unsupported`、`timeout`、`rate-limited`、
`insufficient-data` 作为正常状态处理。关闭 SSH 会话后宿主会清理后续采样状态；该 API 不提供
后台采集、长期历史、多服务器聚合或任意命令执行能力。

### 1.4 样式自由度与宿主 Token

样式采用“固定语义 token + 插件局部实现”的模式:插件可以设计内部信息架构和组件细节，
但颜色、间距、圆角、字体必须优先使用宿主注入的以下变量，不得复制一套全局主题:

| Token | 用途 |
| --- | --- |
| `--myssh-plugin-bg` / `--myssh-plugin-surface` / `--myssh-plugin-surface-raised` | 背景层级 |
| `--myssh-plugin-surface-hover` | hover/选中前的覆盖层 |
| `--myssh-plugin-border` / `--myssh-plugin-border-strong` | 发丝线与强调边框 |
| `--myssh-plugin-text` / `--myssh-plugin-text-strong` / `--myssh-plugin-text-muted` | 文本层级 |
| `--myssh-plugin-accent` / `--myssh-plugin-danger` / `--myssh-plugin-warning` / `--myssh-plugin-success` | 语义色 |
| `--myssh-plugin-space-1` … `--myssh-plugin-space-4` | 4/8/12/16px 间距阶梯 |
| `--myssh-plugin-radius-sm` / `md` / `lg` | 6/8/10px 圆角阶梯 |
| `--myssh-plugin-font-ui` / `--myssh-plugin-font-mono` | UI 与等宽字体 |

插件样式必须以插件根类为作用域，例如 `.mysql-manager { … }`，禁止未限定作用域地写
`button`、`input`、`.tab`、`.panel` 等通用选择器。若需要运行时注入 CSS，必须给每条规则添加
插件根类前缀，或使用 `@scope (.plugin-root) { … }` 将规则限制在插件根节点；禁止覆盖 `:root`、
`body`、`#root` 或 MySSH 的宿主类。宿主 Token 是稳定契约，新增 Token
必须先修改核心仓库的插件文档与类型/样式，再由插件仓库单独适配。

交互样式遵循 [`docs/UI.md`](./UI.md):可点击元素有 `:hover`、`:active`、`:focus-visible`，
hover 受媒体查询保护，禁止 `transition: all`，并尊重 `prefers-reduced-motion`。

### 1.5 跨仓库变更流程

插件仓库不能直接修改 `my-ssh`。需要新增插槽、Token、面板布局或宿主行为时，按以下顺序:

1. 在 `my-ssh` 提 Issue，写清背景、范围、非目标、验收条件和兼容策略。
2. 在 `my-ssh` 建立专门 PR，先实现向后兼容的宿主契约并更新本节文档。
3. 核心 PR 合并并发布包含该契约的 MySSH 版本后，插件仓库再建独立 PR 迁移插件。
4. 插件清单的 `minAppVersion` 收窄到包含契约的版本；插件 CI 运行构建、类型检查和接入冒烟。

插件可以在核心 PR 合并前准备兼容代码，但不得假设未发布的宿主 Token 或行为已经存在。

## 2. 内置插件(核心仓库)

```text
src/renderer/src/plugins/
  <plugin-id>/
    index.ts        # 必须:导出 definePlugin(...) 作为 default
    <Panel>.tsx     # 面板组件(可选)
    data.ts         # 插件私有数据(可选)
```

- 插件目录由 `import.meta.glob('./*/index.ts')` 自动扫描,无需注册到任何配置文件
- 新增插件 = 新建目录 + 编写 `index.ts`,重建后即出现在设置页
- 内置插件无法被用户卸载,应尽量轻量;重 IO 逻辑放主进程通过 IPC 暴露

## 3. 外部插件(市场仓库 my-ssh-plug)

```text
src/
  plugin-types.ts        # 清单接口(与本文档一致)
  <plugin-id>/
    index.ts             # definePlugin({...}) 入口,默认导出
    CommandBar.tsx       # 组件
    data.ts              # 静态数据
    manifest.json        # id / name / version / description / author / category / minAppVersion / maxAppVersion / official / defaultEnabled
official.json            # 官方白名单:构建时对白名单插件盖章 official: true
scripts/
  build.mjs              # esbuild 打包 → dist/<id>/entry.js + dist/registry.json(含 sha256 + 治理字段盖章)
  test.mjs               # 发布前自动检查(清单字段 / 白名单 / 数据),CI 必须通过
```

```bash
cd my-ssh-plug
npm install
npm run build      # 产出 dist/<id>/entry.js + dist/registry.json
npm run typecheck
```

- **react 必须外部化**:bundle 里 `import ... from 'react'` / `'react/jsx-runtime'` 由宿主
  经 import map 提供,禁止打包 React(否则 hooks / context 实例分裂)。构建脚本已用
  `--external:react --external:react/jsx-runtime` 处理
- **加载链路**:MySSH 主进程下载 entry → sha256 校验 → 写入
  `userData/plugins/<id>/<version>/entry.js` → 渲染进程
  `import('myssh-plugin://<id>/<version>/entry.js')` 动态加载(自定义协议,
  已注册 `standard + secure + supportFetchAPI + corsEnabled`)
- **发布**:把 `dist/` 部署到任意静态地址(如 GitHub Pages / release asset),把
  `registry.json` 的 URL 填进核心设置页「插件市场」即可安装 / 更新

## 4. 官方插件标记(跨仓库约束)

「官方」徽章对应 Docker 官方镜像的 OFFICIAL 概念:由 MySSH 官方团队维护、可信赖的插件。
设置页「插件」与「插件市场」在插件名旁显示盾牌「官方」徽章。

### 哪里声明

- **内置插件**:核心仓库 `src/renderer/src/plugins/<id>/index.ts` 里 `official: true`,随应用分发
- **市场插件**:`registry.json` 条目的 `official: true`,安装时由主进程盖章写入
  `manifest.json`;设置页「插件市场」与「插件」列表据此显示徽章

### 为什么不能插件自己声明

`official` 是**盖章字段**,只在可信链路上产生,防止第三方自建插件冒充官方:

1. `my-ssh-plug` 仓库维护官方白名单 `official.json`(插件 `id` + `author` 列表)
2. 该仓库 CI 构建 `registry.json` 时,仅对白名单条目加盖 `official: true`
3. MySSH 安装插件时,把 registry 的 `official` 写入本地 `manifest.json`
   (下载经 sha256 校验,来源可信)
4. 渲染层显示以安装清单为准;插件入口模块里自声明 `official: true` **无效**,
   会被核心应用用清单值覆盖

拆成两个仓库仍能防伪造:registry 由官方仓库 CI 唯一构建,第三方自建 registry 只能
影响自己插件,无法让「官方」徽章出现在非官方插件上。若官方白名单变更,发布新
registry 后用户在「插件市场」点击「重新安装」即可刷新徽章。

## 5. 分类与版本兼容

### 分类表(官方分类,新增分类需在本节登记)

| 分类 id | 名称 | 说明 | 示例 |
| --- | --- | --- | --- |
| `terminal` | 终端增强 | 终端内的小功能:命令搜索、补全、提示 | `command-book` |
| `files` | 文件传输 | 文件传输 / 文件管理增强 | `sftp` |
| `tool` | 效率工具 | 与终端无强关联的通用工具 | — |
| `monitor` | 监控运维 | 系统 / 服务器监控、运维面板 | — |
| `integration` | 服务集成 | 对接第三方服务(云、CI、工单等) | — |
| `other` | 其他 | 未归类的插件 | — |

清单字段 `category` 必须填表内 id;未知 id 按原值展示,归入「其他」筛选。
设置页「插件市场」提供分类筛选下拉。

### 版本兼容声明

外部插件必须声明兼容的 MySSH 版本区间(不声明视为兼容所有版本):

```ts
definePlugin({
  // ...
  minAppVersion: '0.1.0',  // 最低兼容版本(semver)
  maxAppVersion: '0.2.0'   // 可选:最高兼容版本
})
```

- 安装时主进程校验当前 `app.getVersion()` 是否在区间内,不满足直接拒绝并给出明确原因
- 市场列表里不兼容的插件「安装」按钮置灰,悬停提示当前版本与插件要求
- 破坏性 API 变更必须收窄 `maxAppVersion`(或升 `major`);纯新增保持 `minAppVersion` 不变
- 官方插件建议始终声明 `minAppVersion`,历史版本兼容性用测试矩阵保证(见下)

### 平台环境声明

插件依赖特定操作系统能力时(如 WSL 仅存在于 Windows),必须声明支持平台:

```ts
definePlugin({
  // ...
  platforms: ['win32']   // 可选:'win32' | 'darwin' | 'linux';缺省为全平台
})
```

- 声明后,市场列表显示「仅支持 Windows / macOS / Linux」,当前系统不在其中的插件
  「安装」按钮置灰,悬停提示当前平台与插件要求
- 安装时主进程二次校验 `process.platform`,绕过界面直接调用也会被拒绝
- 治理规则与版本区间一致:registry 盖章 > 插件自身声明,安装时固化进 manifest

### 自动化测试与接入验证(外部插件)

`my-ssh-plug` 仓库 CI 必须全部通过后才允许发布 registry:

1. `npm run typecheck` + `npm run build`(含 react 外部化检查)
2. 单元测试:覆盖面板 / 挂件的数据与交互逻辑
3. 接入冒烟测试:在 CI 上把构建产物加载进 MySSH 测试构建(自定义协议
   `myssh-plugin://`),验证面板渲染、`window.ssh` API 调用、会话作用域行为
4. 兼容矩阵:对每个声明兼容的 MySSH 版本跑一遍冒烟测试;无法兼容的历史版本必须
   明确收窄 `minAppVersion` / `maxAppVersion`,不允许含糊
5. `registry.json` 由 CI 生成,统一加盖 `sha256` / `official` / `category` /
   版本区间等治理字段,禁止人工手改

测试未通过的插件不允许进入官方 `registry.json`;第三方自建 registry 不受此约束,
但拿不到「官方」徽章。

## 6. 面板生命周期与作用域

- `scope: 'app'` 的面板在任何时候都可用,组件不接收 props
- `scope: 'session'` 的面板仅在会话连接后显示,组件接收 `{ sessionId, profile }`
- `widget` 组件随终端一同挂载,终端不可用时不会渲染;保持轻量,不要做长任务
- 面板与终端标签**同时保持挂载**,切换标签不会销毁组件;`sessionId` 变化时由 App 重新渲染
- 不要在面板卸载时销毁会话:会话生命周期归 App 管理,组件只负责 UI 与 API 调用
- 面板内避免长任务(阻塞 UI);耗时 / IO 操作必须放主进程

## 7. 能力边界(安全模型)

- 渲染进程无 Node 集成,插件**只能**调用 `window.ssh.*` 暴露的 API
- 需要新能力(如磁盘、隧道、剪贴板)时,按「三件套」同步扩展:
  1. `src/shared/types.ts` — 在 `SshApi` 增加方法签名
  2. `src/main/index.ts` — 注册 `ipcMain.handle/on`
  3. `src/preload/index.ts` — 透传为 `window.ssh` 方法
- 敏感信息(密码、私钥、会话数据)只在主进程处理,禁止经 IPC 暴露

## 8. 状态与数据

- 插件自身配置使用 `localStorage`,命名空间 `myssh:<pluginId>:*`,避免与其他插件冲突
- 全局插件开关由 `plugins/index.ts` 统一管理(`myssh:plugin-states`),插件无需关心
- 体积较大的静态数据(如命令库)放 `data.ts` 随包分发,不要运行时生成
- **磁盘数据约定**:插件需要落盘的缓存 / 临时文件一律写入主进程的
  `userData/plugins/<id>/` 目录(经主进程 IPC 读写)。设置页「存储」会自动统计该目录
  占用,并可为每个插件提供「清理缓存」;外部插件额外提供「卸载」(禁用并删除该目录)

## 9. 性能规范

- 传输、磁盘、网络等重 IO 一律放主进程(`src/main/`),渲染进程只接收进度事件
- IPC 事件频率做节流或合并(如传输进度按字节数而非逐块上报)
- 避免把大对象(文件内容)整体经 IPC 传递;需要流式处理时在主进程内完成
- 面板渲染保持轻量,长列表做虚拟化或分页

## 10. 命名与版本

- `id`:`kebab-case`、唯一、稳定
- 面板组件文件用 `<Name>Panel.tsx`,组件名与文件名一致
- 破坏性变更(如面板 props 变化)必须升 `major` 版本
- 新增命令/数据等向后兼容变更升 `minor`,修复升 `patch`
- 外部插件升级由市场清单的 `version` 驱动,MySSH 会清理旧版本目录避免磁盘堆积

## 11. 发布检查清单

- [ ] `id` 唯一且为 `kebab-case`
- [ ] `description` 清楚说明功能与适用场景
- [ ] `category` 使用官方分类表 id(见 §5),未知分类不通过审查
- [ ] 已声明 `minAppVersion` / `maxAppVersion`,且与 CI 兼容矩阵一致
- [ ] 依赖特定操作系统时已声明 `platforms`,且在非目标平台上有明确的不可用说明
- [ ] 非必需功能设置 `defaultEnabled: false`,不打扰默认用户
- [ ] 外部插件确认 react 已外部化(产物里 `from "react"` 保持裸导入)
- [ ] 所有主进程能力已通过 `SshApi` 暴露,未绕过 IPC
- [ ] 面板在无会话(`scope: 'app'`)或会话断开时表现合理
- [ ] 通过 `npm run typecheck` 与 `npm run build`
- [ ] CI 跑通单测 + 接入冒烟测试 + 兼容矩阵(见 §5)

## 12. 插件一览

| 插件 | id | 类型 | 默认状态 | 说明 |
| --- | --- | --- | --- | --- |
| 文件传输(SFTP) | `sftp` | 内置(官方) | 启用 | 高性能上传/下载,会话内使用 |
| 命令手册 | `command-book` | 外部(market,官方) | 不安装 | 终端底部搜索条:100 条常用命令,关键字匹配,点击复制 |
| MySQL 管理器 | `mysql-manager` | 外部(market,官方) | 不安装 | workspace 工作台；使用官方 Companion Runtime 按需启动 MySQL WebSocket 代理 |
