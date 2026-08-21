# MySSH 架构说明

本文描述稳定的进程边界、依赖方向和新增功能的落点。具体开发规则见 `CONTRIBUTING.md`，Agent
并行协作规则见 `AGENTS.md`。

## 运行时结构

```text
Renderer (React / xterm / plugin UI)
        │  window.ssh.*
        ▼
Preload (contextBridge + typed IPC)
        │  ipcRenderer / ipcMain
        ▼
Main process (SSH / SFTP / storage / updater / market)
        │
        ├── remote SSH servers
        ├── local encrypted profile storage
        ├── local filesystem dialogs and transfers
        └── GitHub Releases / plugin registry
```

官方插件如需本地后台服务，还可使用由 Main process 管理的 Companion Runtime：runtime bundle
由插件市场携带，核心负责校验、受控子进程生命周期、`127.0.0.1:0` 动态端口和临时 token，
renderer 只通过 capability 获取最终 endpoint。具体业务代理不进入核心，也不通过插件之间的依赖
来提供；第一阶段仅允许 registry 盖章的官方纯 JS runtime。

允许的依赖方向是 `renderer → preload API contract → main`。`src/shared/` 保存两侧共享的类型和纯逻辑，
不得反向依赖任一进程实现。

## 目录职责

- `src/main/index.ts`：窗口生命周期和 IPC 组合根，不承载具体业务算法。
- `src/main/ssh.ts`、`sftp.ts`：连接与传输领域能力。
- `src/main/storage.ts`、`profiles.ts`：本地状态与加密凭据。
- `src/main/market.ts`、`updater.ts`：外部插件和应用更新边界。
- `src/preload/index.ts`：唯一 renderer 高权限入口，实现 `SshApi`。
- `src/renderer/src/components/`：应用级界面。
- `src/renderer/src/plugins/`：插件契约、注册表和内置插件。
- `src/shared/types.ts`：IPC 契约；`versions.ts`：无副作用的版本判断。

## 关键数据流

### SSH 会话

连接表单构造 `Profile`，通过 preload 发往主进程；主进程创建 ssh2 会话并将状态、输出和进度事件
推送回 renderer。Renderer 只管理展示状态和 xterm 实例，不持有 SSH 客户端。

### SFTP 与文件预览

目录、上传、下载和保存发生在主进程。远程文件预览内容通过受限 IPC 返回；Office 解析运行在 Web
Worker 中，避免阻塞 UI。大小限制、内容净化和错误处理属于该边界的强制要求。

### 插件加载

内置插件随应用构建；外部插件由 registry 分发并通过 `myssh-plugin://` 加载。插件只能依赖宿主提供的
React 与 `window.ssh.*` API，不能获取 Node 或 Electron 主进程对象。完整契约见 `docs/PLUGIN.md`。

## 新增功能的落点

1. 先把与环境无关的规则建模为 `src/shared/` 或模块内纯函数，并补充单元测试。
2. 文件系统、网络、凭据或系统 API 放在 `src/main/`。
3. 在 `SshApi` 中声明最小跨进程契约，再实现 main handler 与 preload bridge。
4. Renderer 只组合交互和显示；大型状态逻辑优先抽到 hook 或领域组件。
5. 新插件能力同时更新插件文档、兼容声明和接入测试。

## 架构健康信号

- `App.tsx`、设置页和全局样式已较大；新增功能优先提取稳定领域模块，避免继续集中堆叠。
- IPC channel、请求参数和返回值应保持类型化，避免裸字符串与 `unknown` 在多层扩散。
- 不以“减少文件数量”为目标；以边界清晰、修改局部化和可独立测试为准。
- 跨三个以上模块的行为变化应在 `docs/adr/` 增加轻量决策记录，说明背景、决定和后果。
