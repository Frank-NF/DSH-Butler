import { gsap } from 'gsap'

/**
 * DSH插件管家 · 官网动效层
 * 与桌面客户端 src-vue/src/composables/useMotion.ts 保持同源规范：
 * 1. 克制 —— 只动 transform / opacity，时长控制在 0.12~0.38s
 * 2. 统一 —— 所有动效走这里，便于全局降级与调参
 * 3. 可降级 —— 尊重系统「减少动态效果」，降级时直接落到终态，不做补间
 */

/** 系统是否要求减少动效（WCAG 2.3.3 / prefers-reduced-motion） */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** 动效时长（秒） */
export const DUR = {
  tap: 0.12, // 按钮按下反馈
  fast: 0.18, // 小元素进出
  base: 0.26, // 常规过渡
  slow: 0.38, // 页面 / 弹窗
} as const

/** 缓动曲线 */
export const EASE = {
  out: 'power2.out',
  inOut: 'power2.inOut',
  soft: 'power1.out',
  back: 'back.out(1.5)',
} as const

/** 列表/卡片交错进场间隔（秒） */
export const STAGGER = 0.035

type Targets = Element | Element[] | NodeListOf<Element> | string | null | undefined

/** 归一化目标，过滤空值 */
function norm(t: Targets, root?: Element | null): Element[] {
  const list: Element[] = []
  const push = (v: unknown) => {
    if (!v) return
    if (typeof v === 'string') {
      Array.from((root ?? document).querySelectorAll(v)).forEach((el) => list.push(el))
    } else if (v instanceof Element) {
      list.push(v)
    } else if (Array.isArray(v)) {
      v.forEach(push)
    } else if (v instanceof NodeList) {
      Array.from(v).forEach(push)
    } else if ((v as { $el?: Element })?.$el instanceof Element) {
      list.push((v as { $el: Element }).$el)
    }
  }
  push(t)
  return list
}

/** 降级时把元素还原为「无内联样式」的终态 */
function settle(els: Element[]) {
  if (els.length) gsap.set(els, { clearProps: 'all' })
}

/**
 * 进场：淡入 + 轻微上移（列表/卡片/区块通用）
 * stagger > 0 时做交错进场
 */
export function fadeSlideIn(
  target: Targets,
  opts: {
    y?: number
    delay?: number
    duration?: number
    stagger?: number
    root?: Element | null
    onComplete?: () => void
  } = {}
) {
  const els = norm(target, opts.root)
  if (!els.length) return
  if (prefersReducedMotion()) {
    settle(els)
    opts.onComplete?.()
    return
  }
  gsap.fromTo(
    els,
    { opacity: 0, y: opts.y ?? 14 },
    {
      opacity: 1,
      y: 0,
      duration: opts.duration ?? DUR.base,
      delay: opts.delay ?? 0,
      stagger: opts.stagger ?? 0,
      ease: EASE.out,
      clearProps: 'all',
      onComplete: opts.onComplete,
    }
  )
}

/** Hero 主标题进场（先父容器淡入再文字上移，比列表略慢） */
export function heroIn(target: Targets, opts: { root?: Element | null } = {}) {
  const els = norm(target, opts.root)
  if (!els.length) return
  if (prefersReducedMotion()) {
    settle(els)
    return
  }
  gsap.fromTo(
    els,
    { opacity: 0, y: 22 },
    { opacity: 1, y: 0, duration: DUR.slow, stagger: STAGGER * 2, ease: EASE.out, clearProps: 'all' }
  )
}

/** 弹窗进场：淡入 + 轻微放大 */
export function dialogIn(target: Targets, opts: { root?: Element | null; onComplete?: () => void } = {}) {
  const els = norm(target, opts.root)
  if (!els.length) return
  if (prefersReducedMotion()) {
    settle(els)
    opts.onComplete?.()
    return
  }
  gsap.fromTo(
    els,
    { opacity: 0, scale: 0.96, y: 10 },
    { opacity: 1, scale: 1, y: 0, duration: DUR.slow, ease: EASE.out, clearProps: 'all', onComplete: opts.onComplete }
  )
}

/** 弹窗退场：缩小 + 淡出 */
export function dialogOut(target: Targets, opts: { root?: Element | null; onComplete?: () => void } = {}) {
  const els = norm(target, opts.root)
  if (!els.length) {
    opts.onComplete?.()
    return
  }
  if (prefersReducedMotion()) {
    opts.onComplete?.()
    return
  }
  gsap.to(els, {
    opacity: 0,
    scale: 0.96,
    y: 8,
    duration: DUR.fast,
    ease: EASE.inOut,
    onComplete: opts.onComplete,
  })
}

/** 数字滚动（统计条） */
export function countTo(
  target: Targets,
  value: number,
  opts: { root?: Element | null; duration?: number; format?: (n: number) => string } = {}
) {
  const els = norm(target, opts.root)
  if (!els.length) return
  if (prefersReducedMotion()) {
    els.forEach((el) => (el.textContent = (opts.format ?? String)(value)))
    return
  }
  const counter = { v: 0 }
  els.forEach((el) => (el.textContent = (opts.format ?? String)(0)))
  gsap.to(counter, {
    v: value,
    duration: opts.duration ?? 0.8,
    ease: EASE.out,
    onUpdate: () => els.forEach((el) => (el.textContent = (opts.format ?? String)(Math.round(counter.v)))),
  })
}

/** 按钮按下反馈（配合 pointerdown 使用） */
export function pressIn(target: Targets, opts: { root?: Element | null } = {}) {
  const els = norm(target, opts.root)
  if (!els.length || prefersReducedMotion()) return
  gsap.to(els, { scale: 0.96, duration: DUR.tap, ease: EASE.out })
}

/** 按钮松开回弹 */
export function pressOut(target: Targets, opts: { root?: Element | null } = {}) {
  const els = norm(target, opts.root)
  if (!els.length || prefersReducedMotion()) return
  gsap.to(els, { scale: 1, duration: DUR.tap, ease: EASE.back })
}
