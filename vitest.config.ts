import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * vitest 默认读 vite.config.* / vitest.config.*，而本仓库的构建配置在
 * electron.vite.config.ts（electron-vite 专用文件名），vitest 看不到，
 * 于是 `@shared/*` 这类别名在测试里无法解析。
 *
 * 以前没暴露出来，是因为渲染端组件只做 `import type` 引用 @shared（类型在转译时被抹掉）。
 * 服务入口面板在运行期真的引用了 shared 层的收敛函数，需要在这里把别名补上 ——
 * 含义与 electron.vite.config.ts 保持一致，不做第二套。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  // 渲染端组件的静态渲染测试带 JSX。根 tsconfig.json 没有 jsx 字段，
  // 而 esbuild 对 .tsx 的默认是 classic（需要 React 在作用域里），显式指定 automatic。
  esbuild: { jsx: 'automatic' }
})
