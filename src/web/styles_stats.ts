/**
 * 统计页专用样式（P3）。
 *
 * 【为什么单开一个文件】统计页这套视觉与主样式表独立演进：改它不必动 572 行的 styles.ts，
 * 也就不会和同时在改官网/主样式的会话抢同一个文件（此前被回退过两次）。
 *
 * 规范来源：ui-ux-pro-max（chart / ux 两域）—— KPI 用 bullet 表达「指标 vs 目标」；
 * 颜色不单独承载信息（数值与文字始终在位）；空状态给「有帮助 + 有行动」的提示；hover 与键盘同源。
 */
export const STATS_CSS = `
.stats-hero { display: grid; grid-template-columns: repeat(auto-fit, minmax(178px, 1fr)); gap: 12px; margin-bottom: 14px; }
.stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; transition: transform .15s ease, box-shadow .15s ease; }
.stat-card:hover { transform: translateY(-1px); box-shadow: 0 2px 10px rgba(0,0,0,.05); }
.stat-k { font-size: 12.5px; color: var(--text-3); }
.stat-v { font-size: 26px; font-weight: 600; margin: 4px 0 2px; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
.stat-s { font-size: 12px; color: var(--text-3); }
.span2 { grid-column: span 2; }
.bullet-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.bullet-label { font-size: 12.5px; color: var(--text-3); }
.bullet-value { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.bullet-track { position: relative; height: 10px; margin: 8px 0 4px; background: var(--surface-3); border-radius: 5px; }
.bullet-fill { height: 100%; border-radius: 5px; transition: width .35s ease; }
.bullet.ok .bullet-fill { background: #3F8F5A; }
.bullet.warn .bullet-fill { background: #C98A20; }
.bullet.err .bullet-fill { background: var(--brand-fill); }
.bullet-target { position: absolute; top: -3px; width: 2px; height: 16px; background: var(--text-3); border-radius: 1px; }
.bullet-foot { font-size: 11.5px; color: var(--text-3); }
.chart-axis { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--text-3); margin-top: 2px; }
.card svg rect { transition: opacity .15s ease; }
.card svg rect:hover { opacity: .72; }
.hbar { border-radius: 6px; padding: 2px 4px; transition: background .15s ease; }
.hbar:hover { background: var(--surface-2); }
.hbar-fill { background: linear-gradient(90deg, var(--brand) 0%, var(--brand-fill) 100%); }
@media (max-width: 720px) { .hbar { grid-template-columns: minmax(80px, 1fr) 1fr 52px; } .span2 { grid-column: span 1; } }
`;
