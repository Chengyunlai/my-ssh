# MySSH

开源桌面 SSH 客户端:可视化管理服务器(账号密码 / PEM 私钥),连接后内置完整桌面终端能力(真彩色、滚动回看、复制粘贴、自适应尺寸)。

## 技术栈

- [Electron](https://www.electronjs.org/) + [electron-vite](https://electron-vite.org/) + TypeScript
- [React](https://react.dev) 界面
- [xterm.js](https://xtermjs.org/)(VS Code 同款终端渲染)+ `@xterm/addon-fit`
- [ssh2](https://github.com/mscdex/ssh2) 连接协议(密码 / PEM 认证、通道复用)
- 凭据加密:Electron `safeStorage`(macOS 下走 Keychain),落盘为 `profiles.json`
- 插件系统:内置插件(随应用分发)+ 外部插件(独立市场仓库 `my-ssh-plug` 分发,可安装 / 更新 / 卸载)
- UI 动效与设计规范:见 [`docs/UI.md`](docs/UI.md)(基于 emilkowalski/skills 设计工程哲学)

## 开发

```bash
npm install
npm run dev
```

## 常用命令

```bash
npm run typecheck   # 类型检查(main + renderer)
npm run build       # 构建到 out/
npm run dist        # 打包 macOS dmg(dist/)
```

## 目录结构

```text
src/
  main/        # Electron 主进程:窗口、profiles 加密存储、ssh2 会话
  preload/     # contextBridge 桥接,向渲染进程暴露 window.ssh API
  renderer/    # React 界面 + xterm.js 终端
  shared/      # 主进程与渲染进程共享的类型
  renderer/src/plugins/  # 插件注册表(<id>/index.ts + 面板组件)
```

## 插件系统

插件分两类,互相独立维护:

- **内置插件**:源码在 `src/renderer/src/plugins/<id>/`,随应用打包分发,只能禁用、不可卸载
- **外部插件**:由独立仓库 `my-ssh-plug`(与核心仓库并列)构建发布,
  经自定义协议 `myssh-plugin://` 运行时加载,在设置页「插件市场」安装 / 更新 / 卸载

新增内置插件 = 在 `src/renderer/src/plugins/` 下新建目录并导出插件定义,无需改任何配置:

```ts
// src/renderer/src/plugins/my-plugin/index.ts
import { definePlugin } from '../types'
import MyPanel from './MyPanel'

export default definePlugin({
  id: 'my-plugin',
  name: '我的插件',
  version: '0.1.0',
  panel: { title: '标签名', Component: MyPanel }
})
```

- `panel.Component` 会在会话连接后出现在标签栏,收到 `{ sessionId, profile }` 属性
- 插件只能调用 `window.ssh.*` 暴露的 API(会话、SFTP、文件对话框),无法直接访问主进程
- 面板组件与终端同时保持挂载(终端切走不丢会话),大体积逻辑(如 SFTP 传输)应放主进程 `src/main/`,通过 IPC 暴露
- 完整开发规范见 [`docs/PLUGIN.md`](docs/PLUGIN.md)

### 内置插件

- **文件传输(SFTP)** — 默认启用,可在设置页关闭

### 插件市场(外部插件)

左下角「⚙ 设置 → 插件市场」,填入市场清单地址(`registry.json`,支持 `https://` 与本地
`file://`)后即可浏览并安装插件。插件默认不安装,安装后可在「插件」页启用 / 禁用,
非内置插件支持「卸载」(禁用并删除本地数据)。

当前市场仓库 `my-ssh-plug` 提供:

- **命令手册**(`command-book`,默认不安装)— 终端底部的一小条命令搜索框:输入关键字
  (如 `grep`、`压缩`)实时匹配 100 条常用命令,回车或点击复制

发布市场 = 构建 `my-ssh-plug` 后把 `dist/` 部署到任意静态地址,把 `registry.json` 的
URL 填入设置页即可;核心与市场可独立升级。

## SFTP 文件传输(首个插件)

连接后点「文件」标签:浏览远程目录、双击进入、上传/下载、新建目录、删除。

文件在线预览 / 编辑(内置):

- **预览**:点击「预览」或双击文件,文本按扩展名自动语法高亮(与编辑共用同一 CodeMirror 实例)、图片(支持 png/jpg/gif/webp/svg 等)可直接查看;二进制文件提示下载
- **编辑保存**:文本文件点「编辑」进入 CodeMirror 编辑器,保存后写回远程文件并自动刷新目录
- **安全上限**:超过 5MB 只预览前 5MB 并禁用编辑,避免误覆盖

高性能方案(2026-08 在真实腾讯云服务器上实测 10MB):

| 方式 | 下载 | 上传 |
| --- | --- | --- |
| ssh2 `fastGet`/`fastPut`(并发 16,32KB 分块) | 0.35 MB/s | 5.92 MB/s |
| ssh2 流式管道 | 0.34 MB/s | 挂起(不可靠) |
| 系统 `scp` | 0.33 MB/s | — |

- 传输在主进程完成,分块并行窗口(`fastGet`/`fastPut`),避免每块数据经 IPC 往返,本地磁盘直写
- 下载方向实测受服务器出站带宽限制(~2.8Mbps),客户端方案无差异;上传方向并行窗口已跑满
- 实时进度(字节/速度)通过 `sftp:progress` 事件推送,失败自动清理本地/远端半成品文件

## 路线图(建议下一步)

- [ ] 多会话标签页
- [ ] 传输任务取消 / 断点续传
- [ ] 文件夹递归上传下载
- [ ] 会话断线自动重连
- [ ] 隧道/端口转发配置
- [ ] 密码明文展示开关(当前输入后仅加密落盘)
