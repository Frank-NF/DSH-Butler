/* DSH管家 落地页交互：移动端菜单 + 进场动效。两件事，别的不做。 */
(function () {
  "use strict";

  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");

  function closeNav() {
    if (!nav || !toggle) return;
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  }

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.addEventListener("click", function (e) {
      if (e.target && e.target.tagName === "A") closeNav();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeNav();
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 760) closeNav();
    });
  }

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var targets = Array.prototype.slice.call(document.querySelectorAll(".reveal"));

  if (reduced || !("IntersectionObserver" in window)) {
    targets.forEach(function (el) { el.classList.add("is-in"); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-in");
      io.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });

  targets.forEach(function (el) { io.observe(el); });
})();
/* ── 第 7 条：hero 粒子（点阵 + 连线 + 鼠标斥力）───────────────────
   为什么手写而不是引库：需求就这一处，二十来行搞定，引一个粒子库要多几十 KB 与一次构建。
   细节：HiDPI 按 devicePixelRatio 放大画布、宽度变化重算点数、滚出视口暂停、
   系统偏好"减少动态效果"时完全不跑动画（只静态画一帧）。 */
(function () {
  var plate = document.querySelector('.hero-plate');
  if (!plate) return;
  var canvas = plate.querySelector('.hero-particles');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var LINK = 130;          // 连线距离阈值（px）
  var PUSH = 110;          // 鼠标斥力半径（px）
  var COLOR = '#F06A3D';   // 品牌橙红，和 LOGO 同色
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0, pts = [], raf = 0, visible = true;
  var mouse = { x: -9999, y: -9999 };

  function resize() {
    var r = plate.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var count = Math.max(26, Math.min(80, Math.round(W * H / 11000)));
    pts = [];
    for (var i = 0; i < count; i++) {
      pts.push({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35,
        r: 1 + Math.random() * 1.3
      });
    }
  }

  function draw() {
    var i, j, p, dx, dy, d2, d;
    ctx.clearRect(0, 0, W, H);
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      dx = p.x - mouse.x; dy = p.y - mouse.y; d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0.01 && d < PUSH) {
        var f = ((PUSH - d) / PUSH) * 0.85;
        p.vx += (dx / d) * f; p.vy += (dy / d) * f;
      }
      p.x += p.vx; p.y += p.vy;
      p.vx *= 0.982; p.vy *= 0.982;
      if (p.x < 0) { p.x = 0; p.vx = -p.vx * 0.6; } else if (p.x > W) { p.x = W; p.vx = -p.vx * 0.6; }
      if (p.y < 0) { p.y = 0; p.vy = -p.vy * 0.6; } else if (p.y > H) { p.y = H; p.vy = -p.vy * 0.6; }
    }
    for (i = 0; i < pts.length; i++) {
      for (j = i + 1; j < pts.length; j++) {
        dx = pts[i].x - pts[j].x; dy = pts[i].y - pts[j].y; d2 = dx * dx + dy * dy;
        if (d2 < LINK * LINK) {
          ctx.globalAlpha = (1 - Math.sqrt(d2) / LINK) * 0.3;
          ctx.strokeStyle = COLOR;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLOR;
    for (i = 0; i < pts.length; i++) {
      ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, pts[i].r, 0, 6.2832); ctx.fill();
    }
  }

  function loop() {
    raf = 0;
    if (!visible) return;
    draw();
    raf = requestAnimationFrame(loop);
  }

  function start() { if (!raf) raf = requestAnimationFrame(loop); }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  plate.addEventListener('pointermove', function (e) {
    var r = plate.getBoundingClientRect();
    mouse.x = e.clientX - r.left;
    mouse.y = e.clientY - r.top;
  });
  plate.addEventListener('pointerleave', function () { mouse.x = -9999; mouse.y = -9999; });
  window.addEventListener('resize', function () { resize(); if (reduce) draw(); }, { passive: true });

  resize();
  if (reduce) { draw(); return; }
  if (window.IntersectionObserver) {
    new IntersectionObserver(function (es) {
      visible = es[0].isIntersecting;
      if (visible) start(); else stop();
    }, { threshold: 0.05 }).observe(plate);
  }
  start();
})();