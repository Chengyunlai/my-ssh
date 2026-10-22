/** Kubeconfig credentials stay in the Node host; renderer receives opaque identifiers. */
export interface KubernetesConfig { id: string; name: string; contexts: string[] }
export interface KubernetesSavedConfig extends KubernetesConfig { context: string; namespace: string }
export interface KubernetesRememberedState { configs: KubernetesSavedConfig[]; selectedId: string | null }
export interface KubernetesTarget {
  id: string; configId: string; context: string; namespace: string; service: string
  port: number; portName: string; database: 'mysql' | 'postgresql' | 'redis' | 'unknown'
  pods: Array<{ name: string; phase: string; ready: boolean; containers: string[] }>
  forwardable: boolean
}
export interface KubernetesForward {
  id: string; targetId: string; host: '127.0.0.1'; port: number
  state: 'ready' | 'closed'; message?: string
}
export interface KubernetesPodMetrics {
  pod: string; timestamp: string; window: string
  containers: Array<{ name: string; cpuMillicores: number; memoryBytes: number }>
}
export interface KubernetesLogOptions { tailLines: number; sinceSeconds: number; previous: boolean }
export interface KubernetesLogs { text: string; possiblyTruncated: boolean }
export interface KubernetesApi {
  remembered(): Promise<KubernetesRememberedState>
  selectConfig(configId: string): Promise<KubernetesSavedConfig>
  rememberSelection(configId: string, context: string, namespace: string): Promise<void>
  removeConfig(configId: string): Promise<void>
  clearConfigs(): Promise<void>
  metrics(targetId: string, pod: string): Promise<KubernetesPodMetrics>
  logs(targetId: string, pod: string, container: string, options: KubernetesLogOptions): Promise<KubernetesLogs>
  importConfig(): Promise<KubernetesConfig | null>
  discover(configId: string, context: string, namespace: string): Promise<KubernetesTarget[]>
  targets(): Promise<KubernetesTarget[]>
  forward(targetId: string): Promise<KubernetesForward>
  forwards(): Promise<KubernetesForward[]>
  stop(id: string): Promise<void>
}
