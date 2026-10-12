# ADR 0007：第三方终端入口与受限内容预览

状态：采用。关联 [Issue #35](https://github.com/Chengyunlai/my-ssh/issues/35)。

## 背景

1.5.0 的官方插件已适配，但第三方缺少可消费的校验入口；文档纯文字会丢失表格关系。
真实 Vim/tmux 验收发现初始化回显过滤与非 CWD OSC 缓存会干扰全屏应用。

## 决定

- 公开 shared 的纯声明式校验，不给第三方执行 Node/React 的权限。作者共用业务数据，终端合同最低仍可兼容 1.5.0。
- DOCX/PPTX 结构解析在限时 TUI Worker，仅读取 ZIP 内 XML；实际解压/嵌套/输出有界，不运行宏或关系外链。
- Core 的可选 rawBinary 为可信 Node 宿主提供有限字节，跳过缓存，不扩展 Electron IPC。
- Core 只剔除 OSC 7，支持两种终止符，非 CWD 流量原样交给终端；首次用户输入结束初始化回显过滤。
- 用真实 Vim/tmux 和独立 WSL1 发行版验证协议。字体/IME/WSL2 人工观察单独记录，不能从文字断言推断。

## 后果

新增 JSZip/xmldom 直接终端依赖，移除终端 mammoth；桌面原解析器与 API 保持兼容。
终端结构预览不保证 Office 精确排版和动画。新第三方业务仍需源码及宿主合同，不能宣称任意 React 插件自动适配。
CI 的 WSL 发行版仅存在于 runner，验证后按唯一名称注销，不触碰维护者现有机器。
