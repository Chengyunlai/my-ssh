# 终端 UI 开发规范

> 本规范基于 [emilkowalski/skills](https://github.com/emilkowalski/skills/) 的 `emil-design-eng` 设计工程哲学提炼,适用本项目的所有 React 界面与 `styles.css` 改动。

## 1. 设计 Token(唯一数据源)

所有颜色、间距、圆角、阴影、动效参数都必须使用 `:root` 中的 CSS 变量,**禁止硬编码**。改动视觉先改 Token,再改组件。

```css
:root {
  /* 字体(参考 pi-gui 的字体栈) */
  --font-ui: ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, "Cascadia Code", Consolas, monospace;

  /* 颜色:中性深灰工作区 + 深色侧栏 + 强调蓝 #61a6fb */
  --bg: #222225;            /* 工作区 / 主区底色 */
  --bg-panel: #19191c;      /* 侧边栏 / 顶栏 / 标签栏 */
  --bg-raised: #303034;     /* 卡片 / 活动标签 / 浮层 */
  --bg-hover: #29292d;      /* 列表 hover */
  --input-bg: #202024;      /* 输入框 */
  /* 发丝线边框 + 交互覆盖层:前景色 alpha 混合,随主题自动翻转(pi-gui 做法) */
  --border-light: color-mix(in srgb, var(--text-bright) 7%, transparent);
  --border: color-mix(in srgb, var(--text-bright) 12%, transparent);
  --border-strong: color-mix(in srgb, var(--text-bright) 20%, transparent);
  --overlay-subtle: color-mix(in srgb, var(--text-bright) 5%, transparent);
  --overlay-hover: color-mix(in srgb, var(--text-bright) 8%, transparent);
  --overlay-active: color-mix(in srgb, var(--text-bright) 12%, transparent);

  --text: #d0d0d0;
  --text-bright: #fafafa;
  --text-dim: #8f8f8f;
  --accent: #61a6fb;        /* 强调蓝(用户配色) */
  --accent-hover: #7db9ff;
  --accent-soft: color-mix(in srgb, var(--accent) 14%, transparent);
  --accent-soft-strong: color-mix(in srgb, var(--accent) 24%, transparent);
  --accent-tint-border: color-mix(in srgb, var(--accent) 45%, transparent);
  --danger: #ef6a62;
  --danger-strong: #c0524b; /* 状态栏错误底色 */
  --ok: var(--accent);
  --ok-strong: #3f82d6;     /* 状态栏已连接底色 */
  --warn: #dcb762;
  --terminal-bg: #080808;   /* 终端画布:最深(用户配色) */

  /* 焦点环:3px 半透明强调色(pi-gui 做法) */
  --focus-ring-color: color-mix(in srgb, var(--accent) 32%, transparent);
  --focus-ring: 0 0 0 3px var(--focus-ring-color);

  /* 间距:4px 基准 */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;

  /* 圆角:统一阶梯,所有元素只允许使用这套 token */
  --radius-xs: 4px;         /* 极小的点缀 */
  --radius-sm: 6px;         /* 输入框 / 小按钮 */
  --radius-md: 8px;         /* 按钮 / 列表项 / 卡片 */
  --radius-lg: 10px;        /* 面板 / 下拉 / 弹层 */
  --radius-xl: 12px;        /* 大磁贴 / 对话框 */
  --radius-full: 999px;

  /* 阴影 + 发丝线描边(pi-gui 的 hairline-stroke 抬升) */
  --shadow-1: 0 1px 2px rgba(0, 0, 0, 0.35);
  --shadow-2: 0 8px 24px rgba(0, 0, 0, 0.4);
  --shadow-pop: 0 -6px 24px rgba(0, 0, 0, 0.45);
  --elevation-hairline: 0 0 0 0.5px var(--border-heavy);
  --elevation-popover: var(--elevation-hairline), var(--shadow-2);

  /* 原生窗口:顶部工具条高度(与 macOS 红绿灯 / Win 覆盖按钮对齐) */
  --titlebar-height: 44px;

  /* 动效 */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --dur-press: 120ms;   /* 按压反馈 */
  --dur-fast: 150ms;    /* 小浮层 / tooltip */
  --dur-base: 200ms;    /* 通用 UI 过渡 */
  --dur-slow: 250ms;    /* 下拉 / tab 等稍重过渡 */
}
```

> 视觉方向为「现代终端工具质感」(配色按 #222225/#080808/#61a6fb,结构参考 pi-gui):
> 统一顶栏(纯窗口拖拽区)+ 侧边栏(品牌 + 服务器列表 + 底部设置)+ 主区终端 +
> 底部状态栏;无活动栏,去掉 VS Code 式图标栏。终端画布用独立 `--terminal-bg`(#080808),
> 不跟随 `--bg`。面板内边距统一以文件面板(`.sftp-panel`)为准,均为 `12px`;终端
> 横向内边距 `25px`(12 面板 + 1 边框 + 12 单元格),使终端输出起点与文件列表表格文本对齐,输出不贴边。主按钮 accent 绿底深字
> (`#61a6fb` + `#08120b`),不用反白白底;蓝色同时用于状态、选中、焦点等语义位置。
> 顶栏为可拖拽区域(`-webkit-app-region: drag`),交互控件一律 `no-drag`。

## 2. 动效决策框架

写任何动画前,先按顺序回答三个问题。

### 2.1 该不该动?

| 使用频率 | 决策 |
| --- | --- |
| 100+ 次/天(快捷键、命令面板、终端渲染) | **完全不动画** |
| 几十次/天(hover、列表导航、tab 切换) | 去掉或大幅精简,只保留颜色/透明度过渡 |
| 偶尔(弹层、模态、toast) | 标准动画(150-250ms) |
| 罕见/首次(引导、庆祝) | 可以加 delight |

**键盘触发的动作永不添加动画**(如命令手册的实时搜索、回车复制)。终端本身的一切渲染交给 xterm.js,不叠加 CSS 动效。

### 2.2 为什么动?

每个动画必须有明确目的:状态反馈(按钮按压)、空间一致性(toast 方向)、防止突兀(元素出现/消失)。如果答案是"好看"且用户高频看到,就不要动。

### 2.3 用什么缓动 / 多快?

| 场景 | 缓动 | 时长 |
| --- | --- | --- |
| 按钮按压反馈 | `--ease-out` | 100-160ms |
| 小浮层 / tooltip | `--ease-out` | 125-200ms |
| 下拉 / 选择 | `--ease-out` | 150-250ms |
| 模态 / 抽屉 | `--ease-in-out` / 自定义 | 200-500ms |
| 进度条 | `linear` | — |

- **UI 动效一律不超过 300ms**。
- **永远不用 `ease-in`**:起步慢,界面显得迟钝。`ease-out` 起步即反馈。
- 自定义曲线从 `--ease-out` / `--ease-in-out` 出发,不要凭空造。
- 退出快于入场:入场 200ms,退出 120ms 或直接移除。

## 3. 交互三态规范

任何可点击元素必须实现三态:

```css
.btn {
  transition:
    transform var(--dur-press) var(--ease-out),
    background-color var(--dur-base) ease,
    border-color var(--dur-base) ease;
}

/* 按压:即时反馈 */
.btn:active {
  transform: scale(0.97);
}

/* 键盘可达性 */
.btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* hover:只在真正有鼠标的设备生效,避免触屏误触 */
@media (hover: hover) and (pointer: fine) {
  .btn:hover {
    border-color: var(--accent);
  }
}
```

- 按压缩放取 `scale(0.95-0.98)`,不要更小。
- **hover 一律包在 `@media (hover: hover) and (pointer: fine)` 里**。
- 颜色类 hover 用 `background-color` / `color` 过渡,禁止 `filter: brightness()`(触发重绘)。
- `:disabled` 元素:降低透明度并禁用 transform,如 `opacity: 0.5; transform: none;`。

## 4. 浮层与弹层

```css
.cmd-bar-pop {
  transform-origin: bottom left; /* 指向触发器,modal 除外(modal 保持居中) */
  transition:
    opacity var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);

  @starting-style {
    opacity: 0;
    transform: scale(0.96);
  }
}
```

- **入场从 `scale(0.95-0.98) + opacity: 0` 开始,永远不用 `scale(0)`**(现实中没有东西凭空出现)。
- **`transform-origin` 指向触发器位置**(左上弹左下、右上弹右下);只有模态框保持居中。
- 元素挂载式入场用 `@starting-style`(Electron 43 / Chromium 138 已支持),不要用 useEffect 切 class 的旧模式。
- 高频触发元素用 CSS `transition`(可中断、可重定向),**不要用 keyframes**(keyframes 被中断会从零重来)。

## 5. 性能规则

- **只动画 `transform` 和 `opacity`**(GPU 合成,跳过布局与重绘)。禁止动画 `padding / margin / width / height / filter`。
- **禁止 `transition: all`**,必须逐属性声明。
- 进度条这类持续运动用 `linear` + `transition`,可被新值平滑重定向。
- 避免在动画中改 CSS 变量(会触发子元素全量样式重算),直接改元素自身 `transform`。
- 滚动条用 `::-webkit-scrollbar` 细样式 + 半透明 thumb,与暗色主题协调。

## 6. 可访问性

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 1ms !important;
    animation-delay: 0ms !important;
    transition-duration: 1ms !important;
  }
}
```

- 尊重 `prefers-reduced-motion`:去掉位移类动效,保留颜色/透明度过渡(帮助理解状态)。
- 键盘导航必须有可见的 `:focus-visible` 轮廓。
- 触屏设备 hover 态被 `(hover: hover) and (pointer: fine)` 天然屏蔽。

## 7. 文本预览 / 编辑规范(SFTP 文件查看器)

预览与编辑**共用同一个 CodeMirror 实例**:预览 = 只读态(`EditorState.readOnly` + `EditorView.editable` 关闭),编辑 = 可写态,通过 `Compartment.reconfigure` 切换,不重建视图、不丢滚动位置。

- **语言映射优先级**:优先官方 `@codemirror/lang-*` 包,没有的用 `@codemirror/legacy-modes` 的 `StreamLanguage`(shell / nginx / dockerfile / ini / toml / properties 等)。新增语言先查官方包,再考虑 legacy 模式
- **只读态也保留**:选择、复制、滚动、行号、搜索(Cmd-F)全部可用,只是不能改内容
- **换行**:默认开启,长行自动折行、无需横向滚动;按钮显示当前状态「换行:开 / 关」,点击切换 `EditorView.lineWrapping`(Compartment 动态切换)
- **保存快捷键**:编辑态支持 `Cmd/Ctrl-S` 保存(经 `saveRef` 调用最新闭包,避免过期状态)
- **大文件安全**:超过 5MB 只读预览前 5MB 并禁用编辑,防止截断内容覆盖全文件
- **图片**:读取为 base64 data URL 内联预览,支持「适应窗口 / 原始尺寸」切换
- **二进制**:仅提示下载,不做内联展示

## 8. 评审清单

评审 UI 改动时逐项检查,输出格式**必须是 Before/After/Why 三列 Markdown 表格**:

| Issue | Fix |
| --- | --- |
| `transition: all` | 逐属性声明 |
| `scale(0)` 入场 | `scale(0.95) + opacity: 0` |
| `ease-in` | `--ease-out` 或自定义曲线 |
| popover 从中心缩放 | `transform-origin` 指向触发器(modal 除外) |
| 键盘动作带动画 | 移除动画 |
| UI 时长 > 300ms | 压到 150-250ms |
| hover 无媒体查询 | 包 `@media (hover:hover) and (pointer:fine)` |
| 高频元素用 keyframes | 换 transition |
| 无 `:active` / `:focus-visible` | 补按压反馈与焦点轮廓 |
| 入场/退出同速 | 退出快于入场 |
| 整体同时出现 | 加 30-80ms stagger |
| `filter: brightness()` hover | 换 `background-color` |

## 9. 本次优化的 Before / After / Why

| Before | After | Why |
| --- | --- | --- |
| 无设计 token,各处理写死 | `:root` 集中定义 spacing/radius/shadow/easing/duration | 单一数据源,视觉一致可维护 |
| `.btn-primary:hover { filter: brightness(1.1) }` | `.btn-primary:hover { background: var(--accent-hover) }` | `filter` 触发重绘掉帧;颜色过渡更柔和 |
| `.btn` 无按压反馈 | `:active { transform: scale(0.97) }` | 按钮必须响应按压 |
| 无键盘焦点可见态 | `:focus-visible` 统一 outline | 键盘可达性 |
| `transition: all` 无 | 全部逐属性声明 | 避免不必要的属性动画 |
| `.cmd-bar-pop` 纯出现 | `opacity 0 + scale(0.96)` 入场,`transform-origin: bottom left` | 从触发器自然展开 |
| hover 无条件 | 全部包 `@media (hover:hover) and (pointer:fine)` | 触屏不误触 |
| 滚动条系统默认 | 自定义细滚动条 + 半透明 thumb | 暗色下视觉协调 |
| 无 `prefers-reduced-motion` | 全局降级块 | 动效敏感用户可关闭位移 |
| `.slider` 默认缓动 | `--ease-out` 自定义曲线 | 内置缓动缺乏力度 |
| 无 `color-scheme: dark` | `:root { color-scheme: dark }` | 原生控件随暗色主题渲染 |
