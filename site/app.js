(function(){
  "use strict";
  var SHOT = /[?&]shot=1/.test(location.search);
  if (SHOT) document.documentElement.classList.add("shot-mode");
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var desktop = window.matchMedia("(min-width: 900px)").matches;

  /* 主题切换（任何模式都可用） */
  var themeBtn = document.getElementById("themeBtn");
  themeBtn.addEventListener("click", function(){
    var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("site-theme", next); } catch (e) { /* 忽略 */ }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "light" ? "#FAF8F5" : "#12100E");
  });

  /* 打赏弹窗（任何模式都可用） */
  var tipModal = document.getElementById("tipModal");
  var tipBtn = document.getElementById("tipBtn");
  function openTip(){
    tipModal.hidden = false;
    document.body.style.overflow = "hidden";
    var x = tipModal.querySelector(".modal-x");
    if (x) x.focus();
  }
  function closeTip(){
    tipModal.hidden = true;
    document.body.style.overflow = "";
    if (tipBtn) tipBtn.focus();
  }
  if (tipBtn) tipBtn.addEventListener("click", openTip);
  tipModal.querySelectorAll("[data-close]").forEach(function(el){
    el.addEventListener("click", closeTip);
  });
  document.addEventListener("keydown", function(e){
    if (e.key === "Escape" && !tipModal.hidden) closeTip();
  });

  /* FAQ 手风琴（无依赖，始终可用） */
  document.querySelectorAll(".qa").forEach(function(qa){
    var btn = qa.querySelector("button");
    btn.addEventListener("click", function(){
      var open = qa.classList.toggle("on");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });

  /* 移动端菜单 */
  var burger = document.getElementById("burger");
  var mmenu = document.getElementById("mmenu");
  burger.addEventListener("click", function(){
    var open = mmenu.classList.toggle("open");
    burger.setAttribute("aria-expanded", open ? "true" : "false");
    document.body.style.overflow = open ? "hidden" : "";
  });
  mmenu.querySelectorAll("a").forEach(function(a){
    a.addEventListener("click", function(){
      mmenu.classList.remove("open");
      document.body.style.overflow = "";
    });
  });

  if (SHOT || reduced || typeof gsap === "undefined") return;

  gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);
  document.documentElement.classList.add("js");

  /* 锚点平滑滚动 */
  document.querySelectorAll('a[href^="#"]').forEach(function(a){
    a.addEventListener("click", function(e){
      var id = a.getAttribute("href");
      if (id.length < 2) return;
      var t = document.querySelector(id);
      if (!t) return;
      e.preventDefault();
      gsap.to(window, { scrollTo: { y: t, offsetY: 76 }, duration: 0.85, ease: "expo.inOut" });
    });
  });

  /* 首屏入场（标题整行揭示；渐变字拆成逐字会丢色，不能拆） */
  var tl = gsap.timeline({ defaults: { ease: "expo.out" } });
  tl.from("#heroTitle", { opacity: 0, y: 34, duration: 0.9 });
  tl.from("#heroSub", { opacity: 0, y: 24, duration: 0.7 }, "-=0.55")
    .from("#heroCta .btn", { opacity: 0, y: 18, duration: 0.6, stagger: 0.08 }, "-=0.5")
    .from("#heroShot", { opacity: 0, y: 90, rotateX: 14, duration: 1.2, transformOrigin: "top center" }, "-=0.45")
    .from("#heroGlow", { opacity: 0, scale: 0.7, duration: 1.4 }, 0);

  /* 首屏滚动视差 */
  gsap.to("#heroShot", {
    yPercent: -6, scale: 0.97, ease: "none",
    scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true }
  });
  gsap.to("#heroGlow", {
    opacity: 0.25, ease: "none",
    scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true }
  });

  /* 跑马灯 */
  var row = document.getElementById("tickerRow");
  row.innerHTML += row.innerHTML;
  var tick = gsap.to(row, { xPercent: -50, ease: "none", duration: 30, repeat: -1 });
  row.parentElement.addEventListener("mouseenter", function(){ tick.pause(); });
  row.parentElement.addEventListener("mouseleave", function(){ tick.resume(); });

  /* 滚动显现 */
  document.querySelectorAll(".reveal").forEach(function(el){
    gsap.from(el, {
      opacity: 0, y: 28, duration: 0.75, ease: "power2.out",
      scrollTrigger: { trigger: el, start: "top 88%", toggleActions: "play none none none" }
    });
  });

  /* 界面剧场：桌面端钉住横向擦除 */
  var wrap = document.getElementById("theaterWrap");
  var track = document.getElementById("theaterTrack");
  var dots = document.getElementById("theaterDots");
  var shots = track.querySelectorAll(".shot");
  shots.forEach(function(){ dots.insertAdjacentHTML("beforeend", "<i></i>"); });
  var dotEls = dots.querySelectorAll("i");
  function markDot(p){
    var idx = Math.min(shots.length - 1, Math.round(p * (shots.length - 1)));
    dotEls.forEach(function(d, i){ d.classList.toggle("on", i === idx); });
  }
  if (desktop && !SHOT) {
    var getDist = function(){ return Math.max(0, track.scrollWidth - wrap.clientWidth); };
    gsap.to(track, {
      x: function(){ return -getDist(); },
      ease: "none",
      scrollTrigger: {
        trigger: "#theaterPin", start: "top 120px", end: function(){ return "+=" + (getDist() + 200); },
        pin: true, scrub: 0.6, invalidateOnRefresh: true,
        onUpdate: function(self){ markDot(self.progress); }
      }
    });
  } else {
    wrap.addEventListener("scroll", function(){
      var max = wrap.scrollWidth - wrap.clientWidth;
      markDot(max > 0 ? wrap.scrollLeft / max : 0);
    }, { passive: true });
  }

  /* 工作方式：被盖住的卡片轻微后退 */
  var steps = document.querySelectorAll(".step");
  steps.forEach(function(step, i){
    if (i === steps.length - 1) return;
    gsap.to(step, {
      scale: 0.95, opacity: 0.55, ease: "none",
      scrollTrigger: { trigger: steps[i + 1], start: "top 92%", end: "top 45%", scrub: true }
    });
  });

  /* 数字滚动 */
  document.querySelectorAll(".stat b").forEach(function(el){
    var target = parseInt(el.getAttribute("data-count"), 10);
    var suffix = el.getAttribute("data-suffix") || "";
    var obj = { v: 0 };
    ScrollTrigger.create({
      trigger: el, start: "top 90%", once: true,
      onEnter: function(){
        gsap.to(obj, {
          v: target, duration: 1.6, ease: "power2.out",
          onUpdate: function(){ el.textContent = Math.round(obj.v) + suffix; }
        });
      }
    });
  });

  /* 导航：滚动方向显隐 + 当前区块高亮 */
  var nav = document.getElementById("nav");
  ScrollTrigger.create({
    start: "top top-=10", end: 99999,
    onUpdate: function(self){
      nav.classList.toggle("scrolled", self.scroll() > 30);
      nav.classList.toggle("hide", self.direction === 1 && self.scroll() > 500);
    }
  });
  document.querySelectorAll("[data-spy]").forEach(function(link){
    var sec = document.querySelector(link.getAttribute("href"));
    if (!sec) return;
    ScrollTrigger.create({
      trigger: sec, start: "top 45%", end: "bottom 45%",
      onToggle: function(self){ link.classList.toggle("active", self.isActive); }
    });
  });
})();
