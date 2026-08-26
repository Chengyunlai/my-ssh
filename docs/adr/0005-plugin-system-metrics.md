# 0005：通过受控 SSH exec 提供插件系统指标快照

- 状态：接受
- 日期：2026-08-22
- 相关 Issue：#13

## 背景

会话插件需要展示服务器指标，但终端 shell 输出不可可靠解析，Companion Runtime 也不能接触
SSH 凭据或绕过核心会话生命周期。需要在主进程复用已建立的 SSH 连接，返回结构化、可节流的
Linux 快照。

## 决定

- 在 `SshApi.monitor.getSnapshot(sessionId)` 中增加高层宿主 API，不开放任意远程命令。
- 主进程只执行源码中的固定采集脚本，使用独立、无 PTY 的 SSH exec 通道。
- 采集 `/proc/stat`、`/proc/loadavg`、`/proc/meminfo`、`/proc/net/dev`、`/proc/uptime`
  和 `df -P -k`，主进程解析并统一为字节、百分比和秒。
- 单次采集超时 5 秒、输出上限 256 KiB、每 session 最小采样间隔 1.5 秒，单 session
  同时只允许一个采集请求。
- CPU 首次采样返回 `insufficient-data`；网络仅返回累计字节，由插件计算速率。
- 缺少 Linux 数据源时返回 `unsupported`，会话关闭时清理差分状态和 exec 通道。
- IPC handler 校验 `sessionId` 属于发起请求的 renderer，避免跨窗口读取其他会话指标。
- 插件使用 `panel.scope: 'session'`，只在面板 active 时以约 3 秒间隔轮询。

## 后果

插件获得稳定的类型化数据，不会污染用户终端，也不会获得 SSH 凭据或通用命令执行权。
采集会产生少量远端 exec 开销，平台扩展和长期监控需要另立契约。

## 备选方案

- 复用 `openShell` 会混入用户终端输出并受终端控制序列影响。
- Companion Runtime 自行连接服务器会扩大凭据暴露面并脱离 session 生命周期。
- 开放任意 exec 会把高权限命令执行能力暴露给插件，违反最小权限边界。
