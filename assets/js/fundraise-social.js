/* TASK-504: the social media pictures for a fundraiser, drawn in the browser and downloaded as PNGs.
   Inlined into the pictures page (src/fundraising/materials.ts, renderSocial), which carries the
   approved facts as JSON in #socialData and the logos as data URIs, so the canvas is never tainted
   and Download always works, whether the page came from the organiser's private area or the admin.

   Two sizes: a square (1080 x 1080) for a post and a story (1080 x 1920). Maroon, with the logo that
   has white lettering, the title in Playfair Display, an optional meter, and the page address in a
   cream pill. No server image library: canvas only. */
(function () {
  "use strict";

  var SIZES = { square: { w: 1080, h: 1080 }, story: { w: 1080, h: 1920 } };
  var C = {
    maroon: "#800000",
    maroonDeep: "#5c0f18",
    maroonGlow: "#9e1a2a",
    cream: "#F8F5EE",
    gold: "#B8862B",
    goldSoft: "#E9D9B0",
    crimson: "#C02238",
  };
  var HEAD = '"Playfair Display", Georgia, serif';
  var BODY = '"Poppins", system-ui, sans-serif';

  function money(pence) {
    var p = Math.max(0, Math.round(pence || 0));
    var pounds = Math.floor(p / 100);
    var rest = p % 100;
    var whole = String(pounds).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return "£" + whole + (rest ? "." + (rest < 10 ? "0" : "") + rest : "");
  }

  /* Break text into lines no wider than maxWidth, whole words only (a word longer than the line is
     left to overrun rather than split). */
  function wrap(ctx, text, maxWidth) {
    var words = String(text || "").split(/\s+/).filter(Boolean);
    var lines = [];
    var line = "";
    words.forEach(function (w) {
      var next = line ? line + " " + w : w;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = w;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    return lines;
  }

  /* The biggest size from `big` down to `small` at which the text fits in maxLines; at the smallest,
     anything left over is cut with an ellipsis. */
  function fit(ctx, text, font, maxWidth, maxLines, big, small) {
    for (var size = big; size >= small; size -= 4) {
      ctx.font = font.replace("{s}", size);
      var lines = wrap(ctx, text, maxWidth);
      if (lines.length <= maxLines && lines.every(function (l) { return ctx.measureText(l).width <= maxWidth; })) {
        return { size: size, lines: lines };
      }
    }
    ctx.font = font.replace("{s}", small);
    var all = wrap(ctx, text, maxWidth);
    var kept = all.slice(0, maxLines);
    if (all.length > maxLines) kept[maxLines - 1] = kept[maxLines - 1].replace(/[\s,.;:]*$/, "") + "…";
    return { size: small, lines: kept };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    ctx.lineTo(x + w, y + h - r);
    ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    ctx.lineTo(x + r, y + h);
    ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    ctx.lineTo(x, y + r);
    ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
    ctx.closePath();
  }

  /* Text with a little letter spacing where the browser can do it, centred on cx. */
  function spaced(ctx, text, cx, y, spacing) {
    var can = "letterSpacing" in ctx;
    if (can) ctx.letterSpacing = spacing + "px";
    ctx.fillText(text, cx + (can ? spacing / 2 : 0), y);
    if (can) ctx.letterSpacing = "0px";
  }

  function draw(canvas, kind, data, logo, showMeter) {
    var size = SIZES[kind];
    var ctx = canvas.getContext("2d");
    if (!ctx) return false;
    var W = size.w;
    var H = size.h;
    var tall = kind === "story";
    var cx = W / 2;

    // The background: maroon, a soft glow at the top, deeper at the foot.
    var bg = ctx.createRadialGradient(cx, tall ? 260 : 120, 40, cx, tall ? 520 : 360, tall ? 1700 : 1100);
    bg.addColorStop(0, C.maroonGlow);
    bg.addColorStop(0.55, C.maroon);
    bg.addColorStop(1, C.maroonDeep);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // A fine gold frame.
    ctx.strokeStyle = C.gold;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 3;
    roundRect(ctx, 34, 34, W - 68, H - 68, 18);
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    roundRect(ctx, 48, 48, W - 96, H - 96, 12);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    // The logo, then "Fundraising for NBCC".
    var logoSize = tall ? 330 : 230;
    var y = tall ? 230 : 78;
    if (logo) ctx.drawImage(logo, cx - logoSize / 2, y, logoSize, logoSize);
    y += logoSize + (tall ? 70 : 46);
    ctx.fillStyle = C.goldSoft;
    ctx.font = "600 " + (tall ? 36 : 30) + "px " + BODY;
    spaced(ctx, "FUNDRAISING FOR NBCC", cx, y, tall ? 7 : 6);
    // A short gold rule under it.
    ctx.fillStyle = C.gold;
    ctx.fillRect(cx - 60, y + (tall ? 30 : 24), 120, 3);

    // The title.
    var t = fit(ctx, data.title, "800 {s}px " + HEAD, W - 200, tall ? 4 : 3, tall ? 124 : 104, tall ? 64 : 56);
    var lineH = Math.round(t.size * 1.12);
    y += (tall ? 90 : 70) + t.size * 0.8;
    ctx.fillStyle = C.cream;
    ctx.font = "800 " + t.size + "px " + HEAD;
    t.lines.forEach(function (l, i) {
      ctx.fillText(l, cx, y + i * lineH);
    });
    y += (t.lines.length - 1) * lineH;

    // On a story there is room for the short line and the date.
    if (tall && data.line) {
      var s = fit(ctx, data.line, "italic 400 {s}px " + HEAD, W - 240, 3, 46, 36);
      ctx.fillStyle = C.goldSoft;
      ctx.font = "italic 400 " + s.size + "px " + HEAD;
      y += 96;
      s.lines.forEach(function (l, i) {
        ctx.fillText(l, cx, y + i * Math.round(s.size * 1.3));
      });
      y += (s.lines.length - 1) * Math.round(s.size * 1.3);
    }
    if (tall && data.when) {
      ctx.fillStyle = C.cream;
      ctx.font = "400 36px " + BODY;
      y += 72;
      ctx.fillText(data.when, cx, y);
    }

    // The address pill, near the foot.
    var pillY = H - (tall ? 340 : 196);
    var words = data.linkWords || "nbcc.scot";
    var pf = fit(ctx, words, "600 {s}px " + BODY, W - 260, 1, tall ? 40 : 36, 22);
    ctx.font = "600 " + pf.size + "px " + BODY;
    var pw = Math.min(W - 160, ctx.measureText(pf.lines[0] || words).width + 90);
    var ph = pf.size + 44;
    ctx.fillStyle = C.cream;
    roundRect(ctx, cx - pw / 2, pillY, pw, ph, ph / 2);
    ctx.fill();
    ctx.fillStyle = C.maroon;
    ctx.fillText(pf.lines[0] || words, cx, pillY + ph / 2 + pf.size * 0.36);
    if (tall) {
      ctx.fillStyle = C.goldSoft;
      ctx.font = "400 30px " + BODY;
      ctx.fillText(data.linkKind === "page" ? "Give on my page" : "Find out more", cx, pillY - 30);
    }

    // The meter, between the words and the pill.
    if (showMeter && data.raisedPence > 0) {
      var top = y + 40;
      var room = pillY - top - (tall ? 90 : 30);
      var mid = top + room / 2;
      var hasTarget = data.targetPence && data.targetPence > 0;
      var raised = money(data.raisedPence) + " raised";
      ctx.fillStyle = C.cream;
      ctx.font = "800 " + (tall ? 84 : 66) + "px " + HEAD;
      var numY = hasTarget ? mid - (tall ? 6 : 2) : mid + 24;
      ctx.fillText(raised, cx, numY);
      if (hasTarget) {
        var barW = tall ? 760 : 720;
        var barH = tall ? 30 : 26;
        var barY = numY + (tall ? 40 : 30);
        var pct = Math.max(0, Math.min(1, data.raisedPence / data.targetPence));
        ctx.fillStyle = "rgba(248,245,238,0.22)";
        roundRect(ctx, cx - barW / 2, barY, barW, barH, barH / 2);
        ctx.fill();
        if (pct > 0) {
          var fill = ctx.createLinearGradient(cx - barW / 2, 0, cx + barW / 2, 0);
          fill.addColorStop(0, C.gold);
          fill.addColorStop(1, C.goldSoft);
          ctx.fillStyle = fill;
          roundRect(ctx, cx - barW / 2, barY, Math.max(barH, barW * pct), barH, barH / 2);
          ctx.fill();
        }
        ctx.fillStyle = C.goldSoft;
        ctx.font = "400 " + (tall ? 36 : 30) + "px " + BODY;
        ctx.fillText("of " + money(data.targetPence) + " target", cx, barY + barH + (tall ? 58 : 48));
      }
    }

    // The charity, small, at the very foot.
    ctx.fillStyle = "rgba(248,245,238,0.72)";
    ctx.font = "400 " + (tall ? 26 : 22) + "px " + BODY;
    ctx.fillText("Night Before Christmas Campaign · Scottish Charity SC047995", cx, H - (tall ? 110 : 76));
    return true;
  }

  function defaultLoadImage(win, src) {
    return new Promise(function (resolve) {
      if (!src || !win.Image) return resolve(null);
      var img = new win.Image();
      var done = function (ok) {
        resolve(ok ? img : null);
      };
      img.onload = function () {
        done(true);
      };
      img.onerror = function () {
        done(false);
      };
      win.setTimeout(function () {
        done(img.complete && img.naturalWidth > 0);
      }, 4000);
      img.src = src;
    });
  }

  function initSocial(doc, win, opts) {
    opts = opts || {};
    var dataNode = doc.getElementById("socialData");
    var data = {};
    try {
      data = JSON.parse(dataNode ? dataNode.textContent : "{}");
    } catch (e) {
      data = {};
    }
    var status = doc.querySelector("[data-social-status]");
    var meterBox = doc.querySelector("[data-social-meter]");
    var logo = null;

    function say(text) {
      if (status) status.textContent = text;
    }

    function showMeter() {
      return !meterBox || meterBox.checked;
    }

    function drawAll() {
      Array.prototype.forEach.call(doc.querySelectorAll("canvas[data-social]"), function (canvas) {
        var kind = canvas.getAttribute("data-social");
        if (SIZES[kind]) draw(canvas, kind, data, logo, showMeter());
      });
    }

    function save(kind) {
      var canvas = doc.querySelector('canvas[data-social="' + kind + '"]');
      if (!canvas) return;
      var name = "nbcc-" + (data.slug || "fundraiser") + "-" + kind + ".png";
      var failed = function () {
        say("Sorry, we could not make that picture in this browser. Try another browser, or ask us and we will send it.");
      };
      var hand = function (href, revoke) {
        var a = doc.createElement("a");
        a.href = href;
        a.download = name;
        doc.body.appendChild(a);
        a.click();
        doc.body.removeChild(a);
        if (revoke) win.setTimeout(revoke, 30000);
        say("Saved " + name + ". Look in your downloads.");
      };
      try {
        if (canvas.toBlob) {
          canvas.toBlob(function (blob) {
            if (!blob) return failed();
            var url = win.URL.createObjectURL(blob);
            hand(url, function () {
              win.URL.revokeObjectURL(url);
            });
          }, "image/png");
        } else {
          hand(canvas.toDataURL("image/png"), null);
        }
      } catch (e) {
        failed();
      }
    }

    Array.prototype.forEach.call(doc.querySelectorAll("[data-social-download]"), function (btn) {
      btn.addEventListener("click", function () {
        save(btn.getAttribute("data-social-download"));
      });
    });
    if (meterBox) meterBox.addEventListener("change", drawAll);

    var loadImage = opts.loadImage || function (src) {
      return defaultLoadImage(win, src);
    };
    var fonts = doc.fonts && doc.fonts.load
      ? Promise.all([doc.fonts.load('800 80px "Playfair Display"'), doc.fonts.load('italic 400 40px "Playfair Display"'), doc.fonts.load('400 30px "Poppins"')]).catch(function () {})
      : Promise.resolve();
    // Draw at once (so there is something to see), and again once the fonts and logo are in.
    drawAll();
    var ready = Promise.all([fonts, loadImage(data.logoOnDark)]).then(function (got) {
      logo = got[1];
      drawAll();
    });
    return { ready: ready, draw: drawAll, save: save };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initSocial: initSocial, wrap: wrap, money: money };
  } else {
    initSocial(document, window);
  }
})();
