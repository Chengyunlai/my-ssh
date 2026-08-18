// react/jsx-runtime 的 ESM 桥:外部插件 bundle 以命名导入 jsx / jsxs / Fragment,
// 经 import map 解析到这里;jsx 运行时无状态,只依赖共享的 react 实例。
import * as jsxRuntime from '@react-jsx-runtime-cjs'

export const jsx = jsxRuntime.jsx
export const jsxs = jsxRuntime.jsxs
export const Fragment = jsxRuntime.Fragment
