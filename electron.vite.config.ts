import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 为外部插件注入 import map:react / react/jsx-runtime 由宿主提供,
 * 插件市场(bundle)不打包 react,避免多实例导致 hooks / context 分裂。
 * dev 指向 ESM 桥源码(vite dev server 相对根路径),
 * prod 指向分 chunk 后的 assets/*.js,与宿主应用共享同一模块实例。
 */
function pluginImportMap(): Plugin {
  return {
    name: 'myssh-plugin-importmap',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const imports =
          ctx.server !== undefined
            ? {
                react: '/src/vendor/react.ts',
                'react/jsx-runtime': '/src/vendor/react-jsx-runtime.ts'
              }
            : {
                react: './assets/react.js',
                'react/jsx-runtime': './assets/react-jsx-runtime.js'
              }
        return {
          // 内联 importmap 属于 script-src 管辖,动态计算其 sha256 加入 CSP,
          // 否则 meta CSP 会拦截 importmap,导致外部插件里的 react 裸导入无法解析。
          html: _html.replace(
            "script-src 'self' myssh-plugin:",
            `script-src 'self' myssh-plugin: 'sha256-${createHash('sha256').update(JSON.stringify({ imports })).digest('base64')}'`
          ),
          tags: [
            {
              tag: 'script',
              attrs: { type: 'importmap' },
              children: JSON.stringify({ imports })
            }
          ]
        }
      }
    }
  }
}

export default defineConfig(({ command }) => {
  const dev = command === 'serve'
  const reactSuffix = dev ? 'development' : 'production'

  return {
    main: {
      resolve: {
        alias: { '@shared': resolve('src/shared') }
      }
    },
    preload: {
      resolve: {
        alias: { '@shared': resolve('src/shared') }
      }
    },
    renderer: {
      resolve: {
        alias: [
          // react 系列走 ESM 桥:外部插件经 import map 与宿主共享同一实例,
          // 且桥文件提供插件 bundle 需要的命名导出(useState / jsx 等)。
          { find: /^react\/jsx-runtime$/, replacement: resolve('src/renderer/src/vendor/react-jsx-runtime.ts') },
          { find: /^react$/, replacement: resolve('src/renderer/src/vendor/react.ts') },
          { find: /^react-dom\/client$/, replacement: resolve('src/renderer/src/vendor/react-dom-client.ts') },
          { find: /^@react-cjs$/, replacement: resolve(`node_modules/react/cjs/react.${reactSuffix}.js`) },
          { find: /^@react-jsx-runtime-cjs$/, replacement: resolve(`node_modules/react/cjs/react-jsx-runtime.${reactSuffix}.js`) },
          { find: /^@react-dom-client-cjs$/, replacement: resolve(`node_modules/react-dom/cjs/react-dom-client.${reactSuffix}.js`) },
          { find: '@renderer', replacement: resolve('src/renderer/src') },
          { find: '@shared', replacement: resolve('src/shared') }
        ]
      },
      plugins: [react(), pluginImportMap()],
      build: {
        rollupOptions: {
          output: {
            entryFileNames: 'assets/[name].js',
            chunkFileNames: 'assets/[name].js',
            // 保留 react 系列 chunk 的公开导出名,外部插件经 import map
            // 按命名导入(useState / jsx 等),不能依赖压缩后的短名。
            minifyInternalExports: false,
            manualChunks(id) {
              // jsx-runtime 桥文件独立成 chunk,其依赖的 jsx-runtime CJS 与 react 同 chunk,
              // 避免两个 chunk 互相依赖形成环(插件独立动态 import react.js 时会被破坏)。
              if (id.includes('vendor/react-jsx-runtime')) return 'react-jsx-runtime'
              if (
                id.includes('node_modules/react') ||
                id.includes('node_modules/react-dom') ||
                id.includes('node_modules/scheduler') ||
                id.includes('vendor/react')
              )
                return 'react'
            }
          }
        }
      }
    }
  }
})
