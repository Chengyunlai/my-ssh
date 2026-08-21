# 0003：为官方插件提供受控 Companion Runtime

- 状态：接受
- 日期：2026-08-21
- 相关 Issue：待创建（跨仓库：`my-ssh` / `my-ssh-plug`）

## 背景

MySQL Manager 需要一个本地 WebSocket 代理才能访问远程 MySQL。此前代理由用户手动运行，
固定监听 `127.0.0.1:3000`，安装插件后不会自动启动，端口冲突时 renderer 只显示连接失败。
把 MySQL 代理直接放进 MySSH 核心会形成不可复用的业务特例；让 renderer 启动 Node 又会绕过
宿主的生命周期和安全边界。

## 决定

1. MySSH 核心提供通用的 `node-companion-v1` 宿主：安装时校验 runtime bundle，按需启动/停止
   子进程，固定 loopback，使用动态端口和临时 token，并通过类型化 IPC 注入 endpoint。
2. 具体业务 runtime 仍由插件仓库携带。MySQL Manager 只负责 MySQL 协议、连接池业务和 UI，
   不把代理源码移入核心。
3. 首阶段仅允许 MySSH 固定官方 registry 盖章的官方插件；仅支持纯 JS bundle，禁止任意 shell、原生模块和
   插件自定义环境变量/端口。保留显式 `proxyUrl` 作为旧版本和外部部署的回退路径。
4. companion runtime 不建模为“插件依赖另一个插件”，而是插件依赖 MySSH 核心提供的宿主能力。

## 后果

- 未来数据库、云工具和本地索引插件可以复用同一套进程生命周期与 endpoint 契约。
- 核心承担了执行本机代码的安全责任，需要继续完善 registry 签名、权限提示、崩溃策略和跨平台
  打包验证后再开放第三方插件。
- runtime bundle 会增加市场产物体积；runtime 与 renderer entry 分开 hash，升级时必须一起发布。

## 推进

- 核心发布包含宿主契约的版本后，插件再提高 `minAppVersion` 并切换到 capability endpoint。
- MySQL Manager 目前使用“显式 `proxyUrl` 优先、宿主 runtime 次之、无 runtime 时旧默认地址最后”的兼容顺序。
- 后续独立 Issue/PR 负责第三方 runtime 的签名与更严格 capability 绑定，不在本次业务插件中扩张。
