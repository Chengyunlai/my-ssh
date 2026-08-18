/// <reference types="vite/client" />

import type { SshApi } from '@shared/types'

declare global {
  interface Window {
    ssh: SshApi
  }
}

export {}
