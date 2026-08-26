interface FrameScheduler {
  schedule: (callback: () => void) => number
  cancel: (id: number) => void
}

/** 激活隐藏的终端时,在布局完成后重新测量并刷新画布。 */
export function scheduleTerminalRefit(
  active: boolean,
  refit: () => void,
  scheduler: FrameScheduler
): () => void {
  if (!active) return () => {}
  const frame = scheduler.schedule(refit)
  return () => scheduler.cancel(frame)
}
