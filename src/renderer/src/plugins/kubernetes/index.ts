import { definePlugin } from '../types'
import KubernetesPanel from './KubernetesPanel'
export default definePlugin({
  id: 'kubernetes', name: 'Kubernetes', version: '1.0.0', author: 'MySSH',
  description: '通过 kubeconfig 查看 Service 与 Pod，为数据库建立本机连接通道',
  category: 'integration', official: true, builtin: true, defaultEnabled: true,
  panel: { title: 'Kubernetes', scope: 'app', Component: KubernetesPanel }
})
