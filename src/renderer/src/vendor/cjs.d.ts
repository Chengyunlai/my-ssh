// 为 Vite 别名指向的 react CJS 产物声明类型,桥文件再重新导出为 ESM 命名导出。
declare module '@react-cjs' {
  const React: typeof import('react')
  export default React
}

declare module '@react-jsx-runtime-cjs' {
  export const jsx: typeof import('react/jsx-runtime').jsx
  export const jsxs: typeof import('react/jsx-runtime').jsxs
  export const Fragment: typeof import('react/jsx-runtime').Fragment
}

declare module '@react-dom-client-cjs' {
  export const createRoot: typeof import('react-dom/client').createRoot
  export const hydrateRoot: typeof import('react-dom/client').hydrateRoot
  export const version: string
}
