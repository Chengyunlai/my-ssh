import { parentPort, workerData } from 'node:worker_threads'
import { renderPreview } from './preview-render'

void renderPreview(workerData).then((result) => parentPort!.postMessage({ result }), (error: unknown) => parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) }))
