import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { KubernetesClient } = require('myssh-tui/core')
const client = new KubernetesClient()
try {
  const [configPath, context, namespace, service] = process.argv.slice(2)
  if (!configPath || !context || !namespace) throw new Error('Usage: main.mjs /absolute/kubeconfig context namespace [service]')
  const config = await client.importConfig(configPath)
  const targets = await client.discover(config.id, context, namespace)
  console.log('KUBERNETES_OK', { services: new Set(targets.map((target) => target.service)).size, ports: targets.length, databases: targets.filter((target) => target.database !== 'unknown').length })
  if (service) {
    const target = targets.find((target) => target.service === service && target.forwardable)
    if (!target) throw new Error('Service is absent or has no running selected pod')
    if (process.argv.includes('--observe')) {
      const pod = target.pods[0]
      try {
        const metrics = await client.metrics(target.id, pod.name)
        console.log('METRICS_OK', { containers: metrics.containers.length, timestamp: metrics.timestamp })
      } catch (error) { console.log('METRICS_UNAVAILABLE', error.message) }
      const logs = await client.logs(target.id, pod.name, pod.containers[0], { tailLines: 100, sinceSeconds: 86400, previous: false })
      console.log('LOGS_OK', { bytes: Buffer.byteLength(logs.text), possiblyTruncated: logs.possiblyTruncated })
    }
    const tunnel = await client.forward(target.id)
    console.log('FORWARD_OK', tunnel.host, tunnel.port)
    if (target.database === 'redis') {
      const { createConnection } = await import('node:net')
      await new Promise((resolve, reject) => {
        const socket = createConnection({ host: tunnel.host, port: tunnel.port })
        socket.setTimeout(10000)
        socket.on('connect', () => socket.write('*1\r\n$4\r\nPING\r\n'))
        socket.on('data', (chunk) => {
          const recognized = /^(\+PONG|-NOAUTH)/.test(chunk.toString())
          socket.destroy()
          if (recognized) { console.log('REDIS_PROTOCOL_OK'); resolve() }
          else reject(new Error('Unexpected Redis response'))
        })
        socket.on('error', reject)
        socket.on('timeout', () => { socket.destroy(); reject(new Error('Redis probe timed out')) })
        socket.on('end', () => reject(new Error('Upstream ended before response')))
      })
    }
    client.stop(tunnel.id)
    console.log('FORWARD_CLEANED', client.forwards().length === 0)
  }
} finally { client.dispose() }
