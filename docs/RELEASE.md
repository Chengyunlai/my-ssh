# MySSH 发布与自动更新

核心仓库编译产物通过 `electron-builder` + `electron-updater` 分发。发布流程:
改版本 → 构建 → 上传安装包与元数据 → 用户端「设置 → 关于 → 检查更新」/ 启动时静默检查。

CI 中 macOS、Windows、Linux 只并行构建并上传 Actions artifact；全部完成后由唯一的 publish job
汇总并校验必需资产，再创建或更新 GitHub Release。发布 job 在 tag 推送与手动触发之间共用发布锁；
资产校验要求精确的 10 文件集合、常规文件类型、合理大小，并核对 `latest*.yml` 引用资产的
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
