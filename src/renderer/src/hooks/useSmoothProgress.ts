import { useEffect, useRef, useState } from 'react'

/**
 * 连接进度平滑器:
 * - 显示值以缓动逼近最近一次真实进度(target),不会生硬跳变
 * - 两次真实事件间隔太久时缓慢爬升(封顶 90%),避免进度条长时间静止显得卡顿
 * - 只有收到真实 100% 才会到达满格
 */
export function useSmoothProgress(target: number, active = true, creepPerSec = 5): number {
  const [value, setValue] = useState(0)
  const targetRef = useRef(0)
  const valueRef = useRef(0)
  const lastEventRef = useRef(0)
  const creepRef = useRef(creepPerSec)
  creepRef.current = creepPerSec

  // 真实进度事件:记录目标与事件时间
  useEffect(() => {
    targetRef.current = target
    lastEventRef.current = performance.now()
  }, [target])

  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      const t = targetRef.current
      let v = valueRef.current
      if (t >= 100) {
        v = 100
      } else if (v < t) {
        // 向真实进度缓动逼近,同时保证最小爬升速度
        v = Math.min(t, v + Math.max((t - v) * 3.5 * dt, creepRef.current * dt))
      } else if (v > t) {
        v = Math.max(t, v - 50 * dt)
      } else if (now - lastEventRef.current > 600) {
        // 等待真实事件期间缓慢爬升(封顶 90%),保持"正在加载"的观感
        v = Math.min(90, v + creepRef.current * 0.6 * dt)
      }
      if (v !== valueRef.current) {
        valueRef.current = v
        setValue(v)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])

  return value
}
