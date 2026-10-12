# MySSH 发布与自动更新

核心仓库编译产物通过 `electron-builder` + `electron-updater` 分发。发布流程:
改版本 → 构建 → 上传安装包与元数据 → 用户端「设置 → 关于 → 检查更新」/ 启动时静默检查。

CI 中 macOS、Windows、Linux 只并行构建并上传 Actions artifact；全部完成后由唯一的 publish job
汇总并校验必需资产，再创建或更新 GitHub Release。发布 job 在 tag 推送与手动触发之间共用发布锁；
资产校验要求精确的 17 文件集合（含 TUI tgz、三种单文件程序与 SHA-256）、常规文件类型、合理大小，并核对 `latest*.yml` 引用资产的
版本、SHA-512 与大小。禁止矩阵 job 分别执行 `--publish always`，否则可能为同一 tag 创建多个
Release 并把平台产物拆散。

## 1. 版本节奏

- 只改 `package.json` 的 `version`,例如 `0.1.0 → 1.0.0 → 1.1.0`(semver)
- `electron-updater` 只接受**更高版本**(同渠道),所以大版本演进就是正常升号
- 建议每个发布版本打 git tag:`git tag v1.0.0 && git push --tags`

## 2. 构建与发布

默认发布源是 GitHub Releases(见 `electron-builder.yml` 的 `publish`:

```yaml
publish:
  provider: github
  owner: Chengyunlai
  repo: my-ssh
```

### 本地构建,不上传

```bash
npm run dist -- --publish never
# 产物在 dist/ 目录
```

### 构建并发布到 GitHub Releases

```bash
GH_TOKEN=<有 repo 权限的 token> npm run dist -- --publish always
```

electron-builder 会自动上传:

- Windows:`MySSH-<ver>-win-x64.exe`(NSIS)+ `latest.yml`
- macOS:`MySSH-<ver>-mac-<arch>.dmg` + `.zip` + `latest-mac.yml`(`zip` 供自动更新)
- Linux:`MySSH-<ver>-linux-x86_64.AppImage` + `latest-linux.yml`

`latest*.yml` 是更新的“索引”,`electron-updater` 靠它判断版本与下载增量,必须与
安装包放在同一处。

## 3. 用户端更新体验

- 启动时主进程静默 `checkForUpdate()`,发现新版本后在设置页「关于」显示
- 「关于」页有「检查更新 / 下载 / 重启安装」按钮与下载进度条
- 下载完成点「重启安装」:Windows/Linux 直接覆盖更新;macOS 走 Squirrel 替换应用

## 4. 各平台注意事项

| 平台 | 自动更新 | 要求 |
| --- | --- | --- |
| Windows(NSIS) | 支持 | 无额外要求 |
| Linux(AppImage) | 支持 | 无额外要求 |
| macOS(zip 更新载体;dmg 手动安装) | 支持 | **必须 Developer ID 签名**,否则 Squirrel.Mac 拒绝替换 |

macOS 未签名/临时签名(dev 的 ad-hoc)时,自动更新不可用,用户需手动下载 dmg
替换应用;发布正式版前在 `electron-builder.yml` 配置证书(或 CI 里签名)。

## 5. 自定义更新源(自建服务器)

不依赖 GitHub 时,把 `latest*.yml` + 各安装包放到任意静态服务器,运行时指定:

```bash
MYSSH_UPDATE_URL=https://your-server.com/myssh/dist npm run dist
```

或打包后启动应用时带上环境变量;优先级:环境变量 > `electron-builder.yml` 的 GitHub 配置。
服务器需支持 HTTPS,文件按平台放置(Windows 找 `latest.yml`,macOS 找 `latest-mac.yml`)。

## 6. 开发模式

`app.isPackaged === false` 时不检查更新(设置页显示提示)。要本地验证更新链路,
可用 `dev-app-update.yml` + `autoUpdater.forceDevUpdateConfig = true` 测试。

## 7. 发布检查清单

- [ ] `package.json` 版本已递增,git tag 已打
- [ ] `make check` 通过(lint / typecheck / test / build)
- [ ] `npm run dist -- --publish never` 产物齐全(dmg + zip / exe / AppImage + latest*.yml)
- [ ] 已发布到 GitHub Releases(或自定义源),且 `latest*.yml` 与安装包同目录
- [ ] macOS 正式版已 Developer ID 签名
- [ ] 在旧版本上点「检查更新」能发现并完成升级

## 终端版本的分发

Release 的 Linux job 在桌面构建后生成平台无关的 `myssh-tui-<版本>.tgz`，与桌面安装包一起
交给唯一 publish job。资产校验要求该文件存在、为常规文件且大小在 1 KiB–20 MiB。
实际安装需要 Node.js，使用 `npm install -g ./myssh-tui-<版本>.tgz`，之后运行 `myssh`。
独立包包含 Core 公共 API、声明文件、ssh2/xterm 与文档预览依赖；npm 安装不要省略 optional 依赖（Canvas 原生模块按平台分发）。
桌面打包排除 `out/tui/`，headless / serialize 在根项目作为开发依赖，不增大桌面运行依赖。

发布前追加：`npm run verify:tui-package` 验证脱离仓库安装，`npm run verify:tui`
在 macOS/Linux PTY 与 Windows ConPTY 中验证同一交互链；Windows Terminal 字体与 IME
体验仍需人工验收。1.4.0 发布准备及审批状态见 [stage-02](implementation/stage-02.md)。

三平台 job 运行 `npm run verify:tui-portable`，构建 SEA 单文件程序与 `.sha256`，验证后一起上传。
程序内嵌 Node 22 与锁定的运行依赖，启动展开到临时目录，不要求用户安装 Node。
只使用当前平台 Node 生成和注入 SEA blob，macOS 删除旧签名后重新 ad-hoc 签名。
发布资产合同校验每个单文件程序的 SHA-256；运行时许可证及依赖原始许可证随嵌入文件分发。
新解析器增加二进制体积，构建后记录实测大小。当前新增链路未追溯上传到 1.4.0 Release。

1.5.0 还需主仓库三平台插件键盘链路与临时 MySQL 8.4 语义测试通过；
市场仓库的终端入口先经 CI 合入并部署 Pages，回读 registry 的独立终端 hash。
TUI 单文件验证也要在 PATH 无 Node 环境运行插件安装、数据库/命令/监控链路。
