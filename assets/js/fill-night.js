// Fill a Red Bag at night: /fill from the Ball's moment, or with ?at=after-ball (src/red-bag/render.ts
// draws it, assets/css/fill-night.css dresses it). The lights, the sum on the bag and the snow, and that
// is all. The page's own script (assets/js/red-bag.js) still does everything to do with the bag and the
// money, and this hears about it from that script's small "rb:bag" event, never from the words on the
// page. It adds nothing to what is sent, and the page works just the same if this never arrives.
//
// It runs before the page's own script, so it hears the first word. A classic <script defer>, exported
// under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  // The sky is as tall as the page, so its picture is kept to this many pixels: the dots are soft
  // enough not to need more, and a long page on a phone must not cost a screenful of memory for each.
  var MOST_PIXELS = 5000000;
  var MOST_FLAKES = 220;
  var STARS = 60;

  function initFillNight(doc, win) {
    var rb = win && win.NBCCRedBag;
    var night = doc.getElementById("fnNight");
    if (!rb || !night) return null;

    // --- the lights, one for every five pounds of the first bag, and the sum on the bag ---
    var bulbs = [].slice.call(night.querySelectorAll(".bulb"));
    var sum = doc.getElementById("fnSum");
    var sumWords = sum ? sum.querySelector("b") : null;

    function show(detail) {
      var share = Math.min(1, detail.pence / rb.BAG_VALUE_PENCE);
      var lit = Math.floor(share * bulbs.length + 1e-9);
      bulbs.forEach(function (b, i) {
        if (i < lit) b.classList.add("on");
        else b.classList.remove("on");
      });
      if (share >= 1) night.classList.add("full");
      else night.classList.remove("full");
      if (sumWords) {
        sumWords.textContent = rb.pounds(detail.pence);
        // For the one bag still filling: over several, or a full one, it would say less than the bags do.
        sum.hidden = detail.bags !== 1 || share >= 1;
      }
    }

    doc.addEventListener("rb:bag", function (e) {
      if (e && e.detail) show(e.detail);
    });

    // --- the snow: only for those who have not asked for less motion, and only where it can be drawn ---
    var calm = typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (calm) return night;
    var sky = night.querySelector(".fn-sky");
    var ctx = null;
    try {
      ctx = sky && sky.getContext ? sky.getContext("2d") : null;
    } catch (e) {
      ctx = null;
    }
    if (!ctx || typeof win.requestAnimationFrame !== "function") return night;

    var W = 0;
    var H = 0;
    var flakes = [];
    var stars = [];
    var running = false;
    var inView = typeof win.IntersectionObserver !== "function";
    var paused = false;
    var last = 0;

    for (var j = 0; j < STARS; j += 1) stars.push({ x: Math.random(), y: Math.random(), r: 1.5 + Math.random() * 3, p: Math.random() * 6.28 });

    // The page's height changes as things go in the bag: what is falling carries on falling.
    function size() {
      var w = night.clientWidth;
      var h = night.clientHeight;
      if (w === W && h === H) return;
      W = w;
      H = h;
      var r = Math.min(win.devicePixelRatio || 1, 2, Math.sqrt(MOST_PIXELS / Math.max(1, W * H)));
      sky.width = Math.round(W * r);
      sky.height = Math.round(H * r);
      ctx.setTransform(r, 0, 0, r, 0, 0);
      var n = Math.round(Math.min(MOST_FLAKES, (W * H) / 11000));
      flakes.length = Math.min(flakes.length, n);
      while (flakes.length < n) flakes.push({ x: Math.random() * W, y: Math.random() * H, z: 0.35 + Math.random() * 0.65, p: Math.random() * 6.28 });
      // A new size starts as a blank picture: one that is holding still should not go blank with it.
      if (paused) paint(0, 0);
    }

    function star(x, y, r, rot) {
      ctx.beginPath();
      for (var i = 0; i < 10; i += 1) {
        var a = rot + (i * Math.PI) / 5;
        var q = i % 2 ? r * 0.42 : r;
        ctx[i ? "lineTo" : "moveTo"](x + Math.cos(a) * q, y + Math.sin(a) * q);
      }
      ctx.closePath();
      ctx.fill();
    }

    function paint(dt, now) {
      ctx.clearRect(0, 0, W, H);
      var i;
      for (i = 0; i < stars.length; i += 1) {
        var s = stars[i];
        ctx.fillStyle = "rgba(244,201,93," + (0.3 + 0.5 * (0.5 + 0.5 * Math.sin(now / 900 + s.p))).toFixed(3) + ")";
        star(s.x * W, s.y * H, s.r, s.p);
      }
      ctx.fillStyle = "rgb(248,245,238)";
      for (i = 0; i < flakes.length; i += 1) {
        var f = flakes[i];
        f.y += (16 + 44 * f.z) * dt;
        f.x += Math.sin(now / 1500 + f.p) * 12 * f.z * dt;
        if (f.y > H + 6) {
          f.y = -6;
          f.x = Math.random() * W;
        }
        ctx.globalAlpha = 0.22 + 0.6 * f.z;
        ctx.beginPath();
        ctx.arc(f.x, f.y, 0.8 + 2.4 * f.z, 0, 6.29);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function frame(now) {
      if (!inView || paused) {
        running = false;
        return;
      }
      var dt = Math.min(0.05, (now - last) / 1000 || 0);
      last = now;
      paint(dt, now);
      win.requestAnimationFrame(frame);
    }

    function wake() {
      if (running || !inView || paused) return;
      running = true;
      last = win.performance ? win.performance.now() : 0;
      win.requestAnimationFrame(frame);
    }

    var pauseBtn = doc.getElementById("fnPause");
    if (pauseBtn) {
      pauseBtn.hidden = false;
      pauseBtn.addEventListener("click", function () {
        paused = !paused;
        pauseBtn.textContent = paused ? "Start the snow" : "Pause the snow";
        if (paused) night.classList.add("held");
        else night.classList.remove("held");
        wake();
      });
    }

    size();
    if (typeof win.addEventListener === "function") win.addEventListener("resize", size);
    if (typeof win.ResizeObserver === "function") new win.ResizeObserver(size).observe(night);
    if (typeof win.IntersectionObserver === "function") {
      new win.IntersectionObserver(function (es) {
        inView = !!(es.length && es[es.length - 1].isIntersecting);
        wake();
      }).observe(night);
    }
    wake();
    return night;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initFillNight: initFillNight };
  } else {
    initFillNight(document, window);
  }
})();
