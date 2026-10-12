# 0006：Electron 与 TUI 共用 Node 核心

- 状态：接受（本地实现，未发布）
- 日期：2026-10-10
- 相关记录：[设计](../plans/core-tui.md) / [实现](../implementation/stage-01.md)

## 背景

桌面应用安装增加尝试成本。SSH/SFTP、监控、服务发现已分为模块，但直接依赖 WebContents、
safeStorage 和 nativeImage。复制一套 TUI 后端会让两端的认证、采集、传输规则逐渐分叉。

## 决定

将 Node 业务移入 `src/core/`，保持 shared 层纯逻辑和桌面 preload 的公开合同。
Core 以类型化事件和宿主释放合同代替 Electron 对象；公开 `createCore()` 入口隔离宿主会话，
释放时统一关闭 SSH、exec、SFTP 与采集状态。主进程保留系统对话框、图片解码、插件和更新适配。

TUI 在 `src/tui/` 组合核心，使用原生终端输入输出与 headless xterm 的独立 Shell buffer。
文本编辑调用用户的本地编辑器。凭据持久化由宿主注入：桌面 safeStorage；TUI 独立的
scrypt/AES-256-GCM 主密码 vault，不迁移或混用两种加密文件。

TUI 独立 tgz 只声明 Node 运行依赖，桌面排除 TUI 构建目录。CI 覆盖三平台构建和独立安装，
Unix job 追加实际 PTY 操作，统一 gate 保留原检查名称。Release 新增平台无关 tgz 资产。

## 后果

新增宿主复用协议、采集和文件传输代码，不引入 renderer 到 Node 的直接权限路径。
独立 TUI 要求 Node.js；免 Node 的可执行产物需后续分发设计。现有 React 外部插件及图形文档
预览需要专门适配，不能声称两种界面的全部图形交互等价。

传输采用同目录临时文件；临时文件权限为 0600，成功后保存已有目标的权限及远端 owner/group，
不能保存元数据或不能 rename 时返回失败并保留旧目标。远端新文件沿用本地 POSIX 权限，Windows 来源默认 0644。网络中断仍可能
留下临时文件；无授权时不删除正式目标。

## 备选方案

- TUI 直接导入 Electron 主进程模块：仍需安装 Electron，不能独立 Node 运行。
- 复制 SSH/SFTP：认证、超时、安全上限和采集脚本会产生两套实现。
- 改为 Web 后端：新增 HTTP、令牌和浏览器部署边界，不能直接满足终端内交互需求。
