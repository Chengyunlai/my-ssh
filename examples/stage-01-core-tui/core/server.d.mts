import type { Profile } from '../../../src/core'
export function startFixture(): Promise<{ profile: Profile; files: Map<string, Buffer>; metadata: Map<string, { mode?: number; uid?: number; gid?: number }>; close(): Promise<void> }>
