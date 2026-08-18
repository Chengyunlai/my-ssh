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
  builtin: true,                    // 内置插件标记(外部插件置 false)
  defaultEnabled: true,             // 首次启动默认状态,缺省为启用
  panel: {
    title: '标签标题',
    scope: 'session' | 'app',       // app:无需会话;session(默认):需已连接
    Component: PanelComponent
  },
  widget: {
    placement: 'terminal-bottom',   // 终端底部的小型挂件条
    Component: WidgetComponent
  }
})
```

`panel` 与 `widget` 二选一或都提供:

- `panel`:主区域标签页(如文件传输),`scope: 'app'` 无需会话
- `widget`(当前仅 `terminal-bottom`):渲染在终端区域底部的一条轻量组件,接收
  `{ sessionId, profile }`,适合命令搜索条、状态提示等小功能

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
    manifest.json        # id / name / version / description / author / defaultEnabled
scripts/build.mjs        # esbuild 打包 → dist/<id>/entry.js + dist/registry.json(含 sha256)
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

## 4. 面板生命周期与作用域

- `scope: 'app'` 的面板在任何时候都可用,组件不接收 props
- `scope: 'session'` 的面板仅在会话连接后显示,组件接收 `{ sessionId, profile }`
- `widget` 组件随终端一同挂载,终端不可用时不会渲染;保持轻量,不要做长任务
- 面板与终端标签**同时保持挂载**,切换标签不会销毁组件;`sessionId` 变化时由 App 重新渲染
- 不要在面板卸载时销毁会话:会话生命周期归 App 管理,组件只负责 UI 与 API 调用
- 面板内避免长任务(阻塞 UI);耗时 / IO 操作必须放主进程

## 5. 能力边界(安全模型)

- 渲染进程无 Node 集成,插件**只能**调用 `window.ssh.*` 暴露的 API
- 需要新能力(如磁盘、隧道、剪贴板)时,按「三件套」同步扩展:
  1. `src/shared/types.ts` — 在 `SshApi` 增加方法签名
  2. `src/main/index.ts` — 注册 `ipcMain.handle/on`
  3. `src/preload/index.ts` — 透传为 `window.ssh` 方法
- 敏感信息(密码、私钥、会话数据)只在主进程处理,禁止经 IPC 暴露

## 6. 状态与数据

- 插件自身配置使用 `localStorage`,命名空间 `myssh:<pluginId>:*`,避免与其他插件冲突
- 全局插件开关由 `plugins/index.ts` 统一管理(`myssh:plugin-states`),插件无需关心
- 体积较大的静态数据(如命令库)放 `data.ts` 随包分发,不要运行时生成
- **磁盘数据约定**:插件需要落盘的缓存 / 临时文件一律写入主进程的
  `userData/plugins/<id>/` 目录(经主进程 IPC 读写)。设置页「存储」会自动统计该目录
  占用,并可为每个插件提供「清理缓存」;外部插件额外提供「卸载」(禁用并删除该目录)

## 7. 性能规范

- 传输、磁盘、网络等重 IO 一律放主进程(`src/main/`),渲染进程只接收进度事件
- IPC 事件频率做节流或合并(如传输进度按字节数而非逐块上报)
- 避免把大对象(文件内容)整体经 IPC 传递;需要流式处理时在主进程内完成
- 面板渲染保持轻量,长列表做虚拟化或分页

## 8. 命名与版本

- `id`:`kebab-case`、唯一、稳定
- 面板组件文件用 `<Name>Panel.tsx`,组件名与文件名一致
- 破坏性变更(如面板 props 变化)必须升 `major` 版本
- 新增命令/数据等向后兼容变更升 `minor`,修复升 `patch`
- 外部插件升级由市场清单的 `version` 驱动,MySSH 会清理旧版本目录避免磁盘堆积

## 9. 发布检查清单

- [ ] `id` 唯一且为 `kebab-case`
- [ ] `description` 清楚说明功能与适用场景
- [ ] 非必需功能设置 `defaultEnabled: false`,不打扰默认用户
- [ ] 外部插件确认 react 已外部化(产物里 `from "react"` 保持裸导入)
- [ ] 所有主进程能力已通过 `SshApi` 暴露,未绕过 IPC
- [ ] 面板在无会话(`scope: 'app'`)或会话断开时表现合理
- [ ] 通过 `npm run typecheck` 与 `npm run build`

## 10. 插件一览

| 插件 | id | 类型 | 默认状态 | 说明 |
| --- | --- | --- | --- | --- |
| 文件传输(SFTP) | `sftp` | 内置 | 启用 | 高性能上传/下载,会话内使用 |
| 命令手册 | `command-book` | 外部(market) | 不安装 | 终端底部搜索条:100 条常用命令,关键字匹配,点击复制 |
