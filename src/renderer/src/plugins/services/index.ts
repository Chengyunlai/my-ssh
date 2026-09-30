import { definePlugin } from '../types'
import ServicesPanel from './ServicesPanel'

export default definePlugin({
  id: 'services',
  name: '服务入口',
  version: '1.0.0',
  description: '发现远端监听端口,归约成应用与入口(只读内省,不做连通性探测)',
  author: 'MySSH',
  category: 'monitor',
  official: true,
  builtin: true,
  defaultEnabled: true,
  panel: {
    title: '服务',
    Component: ServicesPanel
  }
})
