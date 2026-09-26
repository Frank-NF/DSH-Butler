/**
 * 统计页样式（P3）。
 *
 * 标准来源：high-end-visual-design（Awwwards 级规范）+ ui-ux-pro-max。
 * 落地的三条硬规矩：
 *   ① 不用「1px 灰边框 + 生硬投影」，改发丝线（低对比）+ 极柔和漫射阴影；
 *   ② 不用 linear / ease-in-out，统一 cubic-bezier(.2,.8,.2,1)；
 *   ③ 大留白、非对称（成功率那张卡横跨两列）。
 *
 * 【为什么单开文件】此前把统计样式写进 styles.ts 时被并行会话回退过两次；
 * 独立文件 + 由 /style.css 拼接输出，谁都不会踩到谁。
 * 【上版翻车点】搬到本文件时漏了 .hbar 的 grid 布局与 .hbar-track，
 * 条形塌成一列文字（用户截图指出）。这三条是条形能不能成形的关键，务必保留。
 */
export const STATS_CSS = `
/* 卡片：发丝线 + 柔和漫射阴影（不用生硬投影） */
.stats-hero { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 16px; margin-bottom: 20px; }
.stat-card { position: relative; background: var(--surface); border: 1px solid rgba(0,0,0,.045); border-radius: 14px; padding: 18px 20px;
  box-shadow: 0 1px 2px rgba(20,16,10,.03), 0 10px 30px -12px rgba(20,16,10,.10);
  transition: transform .4s cubic-bezier(.2,.8,.2,1), box-shadow .4s cubic-bezier(.2,.8,.2,1); }
.stat-card::after { content: ''; position: absolute; inset: 0; border-radius: 14px; pointer-events: none;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.6); }
.stat-card:hover { transform: translateY(-2px); box-shadow: 0 2px 4px rgba(20,16,10,.04), 0 18px 44px -16px rgba(20,16,10,.16); }
.stat-k { font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); }
.stat-v { font-size: 32px; font-weight: 650; line-height: 1.1; margin: 8px 0 4px; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.stat-s { font-size: 12px; color: var(--text-3); }
.span2 { grid-column: span 2; }

/* bullet：指标 vs 目标。轨道有内阴影，目标线做成一道刻痕 */
.bullet-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.bullet-label { font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); }
.bullet-value { font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
.bullet-track { position: relative; height: 12px; margin: 10px 0 6px; border-radius: 999px; background: var(--surface-3);
  box-shadow: inset 0 1px 2px rgba(20,16,10,.08); }
.bullet-fill { height: 100%; border-radius: 999px; transition: width .7s cubic-bezier(.2,.8,.2,1); }
.bullet.ok .bullet-fill { background: linear-gradient(90deg, #3F8F5A, #4FA26A); }
.bullet.warn .bullet-fill { background: linear-gradient(90deg, #C98A20, #D9A03A); }
.bullet.err .bullet-fill { background: linear-gradient(90deg, var(--brand), var(--brand-fill)); }
.bullet-target { position: absolute; top: -4px; width: 2px; height: 20px; border-radius: 1px; background: var(--text-2); opacity: .55; }
.bullet-foot { font-size: 11.5px; color: var(--text-3); }

/* 图表：基线 + 轴标 + 柱顶圆角 */
.chart-wrap { padding: 6px 0 2px; }
.chart-axis { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--text-3); margin-top: 4px; }
.card svg rect { transition: opacity .3s cubic-bezier(.2,.8,.2,1), filter .3s cubic-bezier(.2,.8,.2,1); }
.card svg rect:hover { opacity: .85; filter: drop-shadow(0 3px 6px rgba(201,74,32,.28)); }

/* 条形排行 —— 这三条缺一不可，缺了就塌成文字 */
.hbar { display: grid; grid-template-columns: minmax(130px, 210px) 1fr 66px; align-items: center; gap: 14px;
  margin: 0; padding: 9px 10px; border-radius: 10px; transition: background .3s cubic-bezier(.2,.8,.2,1); }
.hbar + .hbar { margin-top: 2px; }
.hbar:hover { background: var(--surface-2); }
.hbar-label { font-size: 13.5px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hbar-track { position: relative; height: 9px; border-radius: 999px; background: var(--surface-3); overflow: hidden;
  box-shadow: inset 0 1px 2px rgba(20,16,10,.07); }
.hbar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--brand) 0%, var(--brand-fill) 100%);
  transition: width .7s cubic-bezier(.2,.8,.2,1); }
.hbar-value { font-size: 13px; text-align: right; color: var(--text-2); font-variant-numeric: tabular-nums; }

/* 区块标题更克制：小字 + 间距，不抢数据 */
.card > .card-title { letter-spacing: .01em; }
@media (max-width: 760px) { .hbar { grid-template-columns: minmax(88px, 1fr) 1fr 54px; gap: 10px; } .span2 { grid-column: span 1; } .stat-v { font-size: 26px; } }
@media (prefers-reduced-motion: reduce) { .stat-card, .bullet-fill, .hbar-fill, .card svg rect { transition: none; } }
`;
