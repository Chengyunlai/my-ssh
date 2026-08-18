// react-dom/client 的 ESM 桥:应用入口 createRoot 使用,与 react 共享同一实例。
import * as reactDomClient from '@react-dom-client-cjs'

export const createRoot = reactDomClient.createRoot
export const hydrateRoot = reactDomClient.hydrateRoot
export default reactDomClient
