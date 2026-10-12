# 真实终端验收

自动测试证明协议、按键字节和屏幕状态；人工验收证明本机字体及输入法的可读性。未运行项保留未验收，不能勾选为通过。
只使用测试发行版、合成文档和临时文件，不需要业务服务器或真实凭据。

## 可执行自动路径

| 路径 | 命令 | 可观察结果 |
| --- | --- | --- |
| 真实 Vim/tmux 经 SSH | `npm run verify:tui-terminal` | `REAL_TERMINAL_OK`；Vim 修改的 UTF-8 文件、tmux 中的实际会话探针、菜单恢复 |
| 三平台独立程序 | `MYSSH_VERIFY_REAL_TERMINAL=1 npm run verify:tui-portable`（Unix） | 应用 PATH 无 Node，预览/SSH/SFTP/插件通过，再运行 Vim/tmux |
| Windows 已安装的测试 WSL | PowerShell：`$env:MYSSH_TEST_WSL_DISTRO='发行版名'; python scripts/verify-wsl.py node` | `REAL_WSL_OK`；真实 Linux 进程、中文命令结果、exit/终端恢复 |
| Windows 单文件 WSL | `python scripts/verify-wsl.py node C:\path\to\myssh.exe` | 同一交接链，应用 PATH 无 Node |

CI 的 `setup-ci-wsl.ps1` 只允许 GitHub Windows runner；使用 SHA-256 固定的 Alpine 3.23.6 rootfs，
创建含 run/attempt/随机标识的 WSL1 发行版；always cleanup 仅注销该名称，不修改用户机器的 WSL。
依据：[runner 的 WSL 配置](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md)、
[Microsoft WSL 命令](https://learn.microsoft.com/windows/wsl/reference)、[Alpine 校验和](https://dl-cdn.alpinelinux.org/alpine/v3.23/releases/x86_64/alpine-minirootfs-3.23.6-x86_64.tar.gz.sha256)。

## 本机人工验收表

在 Windows Terminal、macOS Terminal 和 Linux 的实际终端各记录一次：OS/版本、终端/版本、字体、输入法、MySSH 版本、时间。
不需要把个人用户名、电脑名或服务器信息加入报告。各条填通过/失败/未运行，失败附合成输入与屏幕现象。

| 操作 | 通过条件 |
| --- | --- |
| 搜索菜单时用本机中文输入法输入“命令” | 候选框正常；提交后出现中文，退格不会留下半个字符 |
| 建立测试连接，Shell 输入“你好 SSH”并粘贴多行文字 | 输入不乱码；Ctrl+C 交给远端；Ctrl+] 返回菜单 |
| 菜单中缩小/放大窗口，再进入 Shell | 选中项可见，画面不残留，远端应用收到新的终端尺寸 |
| Vim/tmux 编辑合成文件，返回菜单并恢复 | 光标与内容正确，方向键有效；退出后菜单不继承鼠标/粘贴模式 |
| 预览 DOCX/PPTX/ICO/TIFF | 中文可读，表格关系清楚，颜色块可见，分页与返回有效 |
| Windows `myssh --wsl` | 已安装发行版可选，中文回显正确，exit 返回；分别记录 WSL1/WSL2 |
| 普通 ASCII、中文全角和单个 emoji | 无缺字框或列错位；emoji 宽度取决于远端应用与终端的 Unicode 表，不据此推断所有组合字符兼容 |

真实 WSL1 CI 不等于 WSL2 或所有发行版验收。无机器/无人观察时，本表保持“未运行”，不把字体覆盖与输入法体验算作自动测试结果。
