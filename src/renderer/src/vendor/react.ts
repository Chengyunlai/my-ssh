// react 的 ESM 桥:把真实 CJS 重新导出为命名导出,
// 宿主与外部插件通过 import map 共享同一实例,保证 hooks / context 一致。
import ReactCjs from '@react-cjs'

export default ReactCjs
export const useState = ReactCjs.useState
export const useEffect = ReactCjs.useEffect
export const useRef = ReactCjs.useRef
export const useMemo = ReactCjs.useMemo
export const useCallback = ReactCjs.useCallback
export const useContext = ReactCjs.useContext
export const useReducer = ReactCjs.useReducer
export const useLayoutEffect = ReactCjs.useLayoutEffect
export const useImperativeHandle = ReactCjs.useImperativeHandle
export const useDebugValue = ReactCjs.useDebugValue
export const useDeferredValue = ReactCjs.useDeferredValue
export const useTransition = ReactCjs.useTransition
export const useId = ReactCjs.useId
export const useSyncExternalStore = ReactCjs.useSyncExternalStore
export const useInsertionEffect = ReactCjs.useInsertionEffect
export const createElement = ReactCjs.createElement
export const cloneElement = ReactCjs.cloneElement
export const createContext = ReactCjs.createContext
export const createRef = ReactCjs.createRef
export const forwardRef = ReactCjs.forwardRef
export const memo = ReactCjs.memo
export const lazy = ReactCjs.lazy
export const Suspense = ReactCjs.Suspense
export const Fragment = ReactCjs.Fragment
export const StrictMode = ReactCjs.StrictMode
export const Component = ReactCjs.Component
export const PureComponent = ReactCjs.PureComponent
export const Children = ReactCjs.Children
export const isValidElement = ReactCjs.isValidElement
export const startTransition = ReactCjs.startTransition
export const act = ReactCjs.act
export const version = ReactCjs.version

// react-dom 内部通过 require('react') 读取该键(ReactSharedInternals),
// 必须原样导出,否则 react-dom 拿到的是缺内部键的命名空间,初始化即抛错。
export const __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE =
  (ReactCjs as Record<string, unknown>).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
