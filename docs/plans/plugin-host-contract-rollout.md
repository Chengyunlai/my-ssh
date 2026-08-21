# 插件宿主布局契约：跨仓库迭代计划

- 日期：2026-08-20
- 核心仓库：`Chengyunlai/my-ssh`
- 插件仓库：`Chengyunlai/my-ssh-plug`
- 示例插件：`mysql-manager`

## 目标

让重型插件在 MySSH 分配的内容区内拥有足够的内部设计自由，同时由核心统一控制插件的位置、
最大面积、溢出、主题语义和跨仓库演进流程。插件不得为了修布局直接修改核心仓库。

## 非目标

- 本轮不重做 `mysql-manager` 的数据库功能和信息架构。
- 本轮不增加新的 IPC、文件系统、网络或凭据能力。
- 本轮不把外部插件升级为安全沙箱；DOM/CSS 约束用于布局与维护性，安全边界仍由加载链路和
  `window.ssh.*` API 控制。
- 本轮不自动提交、推送或发布两个仓库。

## 依赖顺序

```text
my-ssh Issue / PR：定义并发布宿主契约
                    │
                    ▼
              MySSH 新版本
                    │
                    ▼
my-ssh-plug Issue / PR：mysql-manager 迁移并收窄 minAppVersion
```

插件 PR 可以提前开发和验证，但必须等核心版本发布后再合并/发布 registry；否则清单会声明一个
用户实际拿不到的宿主能力。

## Issue 1：核心仓库提供插件内容区与布局契约

建议标题：`feat(plugin): 提供宿主管理的插件内容区与布局契约`

跟踪 Issue：[#7](https://github.com/Chengyunlai/my-ssh/issues/7)

### 背景

重型插件需要内部侧栏、工具栏和多标签工作区。当前核心只渲染一个通用 `tab-pane`，插件会自行
定义整页尺寸、背景和溢出，导致位置反复调整、全局类名冲突和主题漂移。

### 范围

- `panel` 增加向后兼容的 `layout: standard | workspace`。
- 核心为面板渲染 `.plugin-surface`，托管位置、面积、溢出、层叠隔离和语义 Token。
- 更新插件规范、领域术语和 ADR。
- 保持既有面板缺省为 `standard`，不要求已有插件同步发布。

### 验收条件

- `standard` 与 `workspace` 面板都被限制在主内容区内。
- 插件不能通过正常布局覆盖顶栏、服务器侧栏或状态栏。
- 既有 `sftp` 和未声明 `layout` 的外部插件正常渲染。
- `make check` 通过。

### 风险

- `contain: layout paint` 可能暴露依赖祖先尺寸或跨 surface 绘制的旧插件问题。
- 宿主 Token 一经发布需保持兼容；删除或改义必须走破坏性版本流程。

## PR 1：核心宿主契约

建议分支：`feat/plugin-host-layout-contract`

唯一负责人文件：

- `src/renderer/src/plugins/types.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/styles.css`
- `docs/PLUGIN.md`
- `docs/adr/0002-plugin-hosted-layout-contract.md`
- `CONTEXT.md`

PR 描述应关联 Issue 1，并说明这是向后兼容的核心契约，不包含 `mysql-manager` 功能改动。

## Issue 2：mysql-manager 迁移到 workspace 内容区

建议标题：`refactor(mysql-manager): 迁移到 MySSH workspace 插件内容区`

### 依赖

- 阻塞于核心 Issue 1 / PR 1。
- 核心发布版本号确定后，更新 `mysql-manager.minAppVersion`。

### 范围

- 清单声明 `scope: app`、`layout: workspace`。
- 根节点填充 `.plugin-surface`，内部侧栏保持 240–320px，并在窄窗口收缩。
- 所有注入 CSS 约束到 `.mysql-manager`，不污染 `.tab`、`.sidebar` 等宿主类。
- 逐步用 `--myssh-plugin-*` Token 替换硬编码主题。
- 构建与测试阻止非法 `layout`、`position: fixed`、全局宿主选择器和 `transition: all`。

### 验收条件

- MySQL 工作台只占据插件内容区；MySSH 顶栏、服务器侧栏和状态栏保持可见、可用。
- 窗口宽度缩小时不产生页面级横向滚动，内部列表/表格自行滚动。
- 插件开关、安装、更新、卸载流程不变。
- `npm run typecheck && npm test && npm run build` 通过。
- 在核心新版本中完成一次安装/加载/切换标签/窗口缩放的人工冒烟。

## PR 2：插件迁移

建议分支：`refactor/mysql-manager-host-contract`

唯一负责人文件：

- `src/plugin-types.ts`
- `src/mysql-manager/index.ts`
- `src/mysql-manager/manifest.json`
- `src/mysql-manager/inject-styles.ts`
- `scripts/test.mjs`
- `scripts/build.mjs`
- `README.md`

当前 `feature/mysql-manager` 上已有功能改动时，先把功能改动整理成独立 PR；宿主契约迁移应从其
合并后的基线新建分支，避免一个 PR 同时审查数据库功能、样式重做和核心兼容策略。

## 版本与发布门槛

1. 合并核心 PR 1。
2. 发布包含宿主契约的 MySSH patch/minor 版本，记录实际版本号。
3. 把 `mysql-manager` 的 `minAppVersion` 更新为该实际版本；不能预填尚未发布的版本。
4. 合并插件 PR 2，提升插件版本，并生成新的 `registry.json`。
5. 在干净安装和已有安装升级两条路径各做一次冒烟，再部署市场 registry。

## 后续阶段

- 将运行时 CSS 作用域处理抽成市场仓库共享构建能力，避免每个插件自写。
- 为 `plugin-surface` 增加最小接入测试夹具，覆盖标准/工作台/窄窗口/多面板切换。
- 评估是否提供宿主 UI primitives（按钮、输入、工具栏、空状态）；只有至少三个插件出现稳定
  重复模式后再抽取，避免过早限制插件内部设计自由。
