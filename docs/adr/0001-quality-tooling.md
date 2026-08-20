# 0001：采用 Oxc lint 与 Vitest 作为质量门禁

- 状态：接受
- 日期：2026-08-20
- 相关 Issue：用户直接发起的仓库治理优化，后续维护任务应补建 Issue

## 背景

仓库原有 `typecheck` 和 `build`，但没有静态检查与单元测试。项目使用 TypeScript 7；实施时最新
`typescript-eslint@8.67.0` 声明的 peer 范围为 TypeScript `<6.1`，强制安装会产生不受支持的组合。

## 决定

- 使用 `oxlint` 做无需绑定 TypeScript 编译器版本的快速静态检查。
- 使用与现有 Vite 7 兼容的 Vitest 运行单元测试。
- `make check` 和 PR CI 统一执行 lint、类型检查、测试和生产构建。
- 两项工具仅作为开发依赖；Action 使用完整提交 SHA，依赖更新由 Dependabot 提醒。

## 后果

新增跨平台 Oxc 可选二进制与 Vitest 依赖，lockfile 体积会增加。收益是本地与 CI 使用同一入口，
未使用符号、基础代码问题和纯逻辑回归能在合并前被发现。Oxc 默认规则与项目有意实现冲突时，
必须在 `.oxlintrc.json` 中写出窄范围例外，不能通过关闭整个 lint 门禁绕过。

## 备选方案

- `typescript-eslint`：生态成熟，但当前 peer 范围不支持本项目 TypeScript 7。
- 仅保留 `tsc`：无法覆盖未使用代码和更多静态规则，也没有行为回归测试。
