/**
 * 轻量内存限频器（单进程适用）
 * - 按 key（IP/邮箱/用户名）限频
 * - 滑动窗口：窗口内超过 max 次则拒绝
 * - 定时清理过期条目，防止内存膨胀
 */
interface Bucket {
  timestamps: number[]
}

const buckets = new Map<string, Bucket>()
let lastSweep = Date.now()

/** 检查是否允许通过；通过则记录本次，拒绝则返回 false */
export function rateLimit(key: string, windowMs: number, max: number): boolean {
  const now = Date.now()

  // 定期清理（每 10 分钟扫一次过期桶）
  if (now - lastSweep > 10 * 60 * 1000) {
    lastSweep = now
    for (const [k, b] of buckets) {
      const cutoff = now - 10 * 60 * 1000
      b.timestamps = b.timestamps.filter((t) => t > cutoff)
      if (b.timestamps.length === 0) buckets.delete(k)
    }
  }

  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = { timestamps: [] }
    buckets.set(key, bucket)
  }

  const cutoff = now - windowMs
  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff)

  if (bucket.timestamps.length >= max) {
    return false
  }
  bucket.timestamps.push(now)
  return true
}

/** 获取当前 key 最近窗口内的次数 */
export function rateCount(key: string, windowMs: number): number {
  const bucket = buckets.get(key)
  if (!bucket) return 0
  const cutoff = Date.now() - windowMs
  return bucket.timestamps.filter((t) => t > cutoff).length
}
