import { useId } from 'react'
import type { ReactNode } from 'react'

interface IconProps {
  size?: number
}

/* OOUI 静态图标统一外壳:20 viewBox / fill currentColor */
function OouiBase({ size = 18, children }: IconProps & { children: ReactNode }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      {children}
    </svg>
  )
}

/* MDI 静态图标外壳:24 viewBox / fill currentColor */
function MdiBase({ size = 18, children }: IconProps & { children: ReactNode }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {children}
    </svg>
  )
}

export function AddIcon({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <OouiBase size={size}>
      <path d="M11 9h7v2h-7v7H9v-7H2V9h7V2h2z" />
    </OouiBase>
  )
}

export function CloseIcon({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <OouiBase size={size}>
      <path d="M16.707 4.707 11.414 10l5.293 5.293-1.414 1.414L10 11.414l-5.293 5.293-1.414-1.414L8.586 10 3.293 4.707l1.414-1.414L10 8.586l5.293-5.293z" />
    </OouiBase>
  )
}

export function CheckIcon({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <OouiBase size={size}>
      <path d="M18.154 3.837 8 16.8H6.65l-4.8-3.6 1.2-1.6 4.02 3.015 9.517-12.02z" />
    </OouiBase>
  )
}

/* MDI shield-check:官方插件徽章图标 */
export function OfficialIcon({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <MdiBase size={size}>
      <path d="M12 2C17.52 2 22 6.48 22 12C22 17.52 17.52 22 12 22C6.48 22 2 17.52 2 12C2 6.48 6.48 2 12 2M12 4C7.58 4 4 7.58 4 12C4 16.42 7.58 20 12 20C16.42 20 20 16.42 20 12C20 7.58 16.42 4 12 4M10.17 13.63L8.19 11.65L6.78 13.06L10.17 16.45L17.22 9.4L15.81 8L10.17 13.63Z" />
    </MdiBase>
  )
}

export function DownloadIcon({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <OouiBase size={size}>
      <path d="M19 19H1v-2h18zm-8-7.104 3.5-3.5 1.414 1.414-5.207 5.208H9.293L4.086 9.81 5.5 8.396l3.5 3.5V1h2z" />
    </OouiBase>
  )
}

export function EditIcon({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <OouiBase size={size}>
      <path d="m15.4.4 4.2 4.2-3.2 3.2-4.2-4.2zM10.8 5 15 9.2l-8.6 8.6-4.5 1.5-1.2-1.2 1.5-4.5z" />
    </OouiBase>
  )
}

export function LinkIcon({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <OouiBase size={size}>
      <path d="M5.862 7.453a4.353 4.353 0 0 1 6.167-.01l.707.706-1.414 1.414-.707-.707a2.355 2.355 0 0 0-3.335.005L4.354 11.81a2.725 2.725 0 0 0 3.842 3.868l.046-.046.715-.7 1.4 1.43-.715.698-.046.046A4.727 4.727 0 0 1 2.934 10.4z" />
      <path d="M10.405 2.894a4.726 4.726 0 0 1 6.662 6.707l-2.928 2.947a4.354 4.354 0 0 1-6.167.01l-.707-.707 1.414-1.415.707.707c.921.921 2.416.92 3.334-.004l2.928-2.948a2.727 2.727 0 0 0-3.843-3.868l-.761.746-1.4-1.428.713-.7z" />
    </OouiBase>
  )
}

export function MenuIcon({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <OouiBase size={size}>
      <path d="M1 3h18v2H1zm0 6h18v2H1zm0 6h18v2H1z" />
    </OouiBase>
  )
}

export function SearchIcon({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <OouiBase size={size}>
      <path d="M8 1a7 7 0 0 1 5.605 11.191l5.102 5.102-1.414 1.414-5.102-5.102A7 7 0 1 1 8 1m0 2a5 5 0 1 0 0 10A5 5 0 0 0 8 3" />
    </OouiBase>
  )
}

export function SettingsIcon({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <OouiBase size={size}>
      <path d="M11.835 3.505a6.7 6.7 0 0 1 1.46.603l2.362-1.18 1.414 1.415-1.18 2.361a6.7 6.7 0 0 1 .603 1.46L19 9v2l-2.506.835a6.7 6.7 0 0 1-.603 1.46l1.18 2.362-1.414 1.414-2.362-1.18a6.7 6.7 0 0 1-1.46.603L11 19H9l-.836-2.506a6.7 6.7 0 0 1-1.46-.603l-2.361 1.18-1.414-1.414 1.18-2.362a6.7 6.7 0 0 1-.604-1.46L1 11V9l2.505-.836a6.7 6.7 0 0 1 .603-1.46l-1.18-2.361 1.415-1.414 2.361 1.18a6.7 6.7 0 0 1 1.46-.604L9 1h2zM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6" />
    </OouiBase>
  )
}

export function TrashIcon({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <OouiBase size={size}>
      <path d="M10 0a3 3 0 0 1 3 3v1h5v2h-2v14H4V6H2V4h5V3a3 3 0 0 1 3-3M6 18h8V6H6zm4-16a1 1 0 0 0-1 1v1h2V3a1 1 0 0 0-1-1" />
    </OouiBase>
  )
}

export function UploadIcon({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <OouiBase size={size}>
      <path d="M19 19H1v-2h18zM10.703 1l5.211 5.117-1.406 1.422L11 4v11H9V4L5.492 7.54 4.086 6.116 9.296 1z" />
    </OouiBase>
  )
}

export function WindowIcon({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <OouiBase size={size}>
      <path d="M2 2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm0 2h16v12H2z" />
      <path d="M4 6h12v2H4z" />
    </OouiBase>
  )
}

export function ArrowBackIcon({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <OouiBase size={size}>
      <path d="M8.124 5.335 4.077 9.5H18v2H4.07l4.054 4.188-1.437 1.391L1 11.196V9.804L6.69 3.94l1.434 1.394z" />
    </OouiBase>
  )
}

export function RefreshIcon({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <MdiBase size={size}>
      <path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 0 0-8 8 8 8 0 0 0 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18a6 6 0 0 1-6-6 6 6 0 0 1 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z" />
    </MdiBase>
  )
}

export function FolderIcon({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <MdiBase size={size}>
      <path d="M10 4H4c-1.11 0-2 .89-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z" />
    </MdiBase>
  )
}

export function FileIcon({ size = 18 }: IconProps): React.JSX.Element {
  return (
    <OouiBase size={size}>
      <path d="M2 0h16v20H2zm2 2v16h12V2zm2 2h3v1H6zm0 2h3v1H6zm0 2h3v1H6zm0 3h8v1H6zm0 2h8v1H6zm0 2h8v1H6zm4-11h4v5h-4z" />
    </OouiBase>
  )
}

/* 连接动效:logo 三圆从独立状态汇聚,gooey 融合成 logo 造型,循环往复。
   与 docs/logo/final/myssh-icon.svg 同构(相同滤镜与终点坐标),repeatCount=indefinite:
   动效时长天然绑定连接时长,连接完成瞬间由外层触发收尾(见 App.tsx 的 settling)。 */
export function GooeyLogoIcon({ size = 96 }: IconProps): React.JSX.Element {
  const filterId = `gooey-logo-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const dur = '2.8s'
  const keyTimes = '0;0.45;0.8;1'
  const keySplines = '0.22 0.61 0.36 1;0.4 0 1 1;0.6 0 1 0.4'
  const circle = (cx: string, cy: string, r: string) =>
    `<circle>` +
    `<animate attributeName="cx" values="${cx}" keyTimes="${keyTimes}" keySplines="${keySplines}" calcMode="spline" dur="${dur}" repeatCount="indefinite"/>` +
    `<animate attributeName="cy" values="${cy}" keyTimes="${keyTimes}" keySplines="${keySplines}" calcMode="spline" dur="${dur}" repeatCount="indefinite"/>` +
    `<animate attributeName="r" values="${r}" keyTimes="${keyTimes}" keySplines="${keySplines}" calcMode="spline" dur="${dur}" repeatCount="indefinite"/>` +
    `</circle>`
  const body =
    `<defs><filter id="${filterId}">` +
    '<feGaussianBlur in="SourceGraphic" stdDeviation="5.5" result="blur"/>' +
    '<feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -11" result="goo"/>' +
    '<feComposite in="SourceGraphic" in2="goo" operator="atop"/>' +
    `</filter></defs>` +
    `<g fill="currentColor" filter="url(#${filterId})">` +
    circle('12;36;36;12', '50;58;58;50', '8;16;16;8') +
    circle('88;64;64;88', '40;44;44;40', '8;12;12;8') +
    circle('68;68;68;68', '66;66;66;66', '2;6;6;2') +
    '</g>'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: body }}
    />
  )
}
