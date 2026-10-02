/* TASK-504: the social media pictures for a fundraiser, drawn in the browser and downloaded as PNGs.
   Inlined into the pictures page (src/fundraising/materials.ts, renderSocial), which carries the
   approved facts as JSON in #socialData and the logos as data URIs, so the canvas is never tainted
   and Download always works, whether the page came from the organiser's private area or the admin.

   TASK-512, round two: five sizes (src/fundraising/materials.ts, SOCIAL_SIZES), the logo as big as
   each layout allows, the charity's shorter statement at the foot of every picture, and every
   picture at once as a zip (makeZip: stored, not compressed, which PNGs barely are anyway; no
   library). Maroon, with the logo that has white lettering, the title in Playfair Display, an
   optional meter, and the page address in a cream pill. No server image library: canvas only.

   Tall and square pictures stack everything down the middle; the two wide ones (a Facebook post and
   a Facebook event cover) put the logo on the left and the words on the right. */
(function () {
  "use strict";

  var SIZES = {
    square: { w: 1080, h: 1080 },
    portrait: { w: 1080, h: 1350 },
    story: { w: 1080, h: 1920 },
    facebook: { w: 1200, h: 630 },
    cover: { w: 1920, h: 1005 },
  };
  var ORDER = ["square", "portrait", "story", "facebook", "cover"];

  // The tall and square layouts. top: where the logo starts; stmtFoot: how far from the foot the
  // statement's last line sits (the address pill goes just above it); stmt: its size. A story keeps clear of
  // the top and foot, where Instagram and Facebook draw their own buttons.
  var TALL = {
    square: { top: 66, minLogo: 170, maxLogo: 330, eyebrow: 30, titleLines: 3, titleBig: 100, titleSmall: 54, lineLines: 0, when: false, pillText: 36, meterNum: 66, stmt: 22, stmtFoot: 74 },
    portrait: { top: 84, minLogo: 200, maxLogo: 400, eyebrow: 32, titleLines: 3, titleBig: 110, titleSmall: 58, lineLines: 2, when: true, pillText: 38, meterNum: 74, stmt: 24, stmtFoot: 92 },
    story: { top: 230, minLogo: 240, maxLogo: 440, eyebrow: 36, titleLines: 4, titleBig: 124, titleSmall: 64, lineLines: 3, when: true, pillText: 40, meterNum: 84, stmt: 26, stmtFoot: 262, caption: true },
  };
  // The wide layouts: the logo on the left, the words centred in the column to its right.
  var WIDE = {
    facebook: { pad: 52, logo: 400, gap: 56, eyebrow: 24, titleLines: 3, titleBig: 72, titleSmall: 40, lineLines: 0, when: false, pillText: 28, meterNum: 52, stmt: 18 },
    cover: { pad: 86, logo: 640, gap: 90, eyebrow: 34, titleLines: 3, titleBig: 112, titleSmall: 60, lineLines: 2, when: true, pillText: 38, meterNum: 76, stmt: 26 },
  };

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
  var STATEMENT = "Night Before Christmas Campaign (NBCC), a Scottish Charitable Incorporated Organisation, SC047995";

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
    for (var size = big; size >= small; size -= 2) {
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

  function background(ctx, W, H) {
    var big = Math.max(W, H);
    var bg = ctx.createRadialGradient(W / 2, H * 0.12, 40, W / 2, H * 0.3, big);
    bg.addColorStop(0, C.maroonGlow);
    bg.addColorStop(0.55, C.maroon);
    bg.addColorStop(1, C.maroonDeep);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // A fine gold frame.
    var inset = Math.round(Math.min(W, H) * 0.032);
    ctx.strokeStyle = C.gold;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 3;
    roundRect(ctx, inset, inset, W - inset * 2, H - inset * 2, 18);
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    roundRect(ctx, inset + 14, inset + 14, W - inset * 2 - 28, H - inset * 2 - 28, 12);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* What goes under the logo, measured before anything is drawn, so the logo can take what is left. */
  function measure(ctx, data, L, width, showMeter) {
    var m = {};
    m.title = fit(ctx, data.title, "800 {s}px " + HEAD, width, L.titleLines, L.titleBig, L.titleSmall);
    m.titleStep = Math.round(m.title.size * 1.12);
    m.line = L.lineLines && data.line ? fit(ctx, data.line, "italic 400 {s}px " + HEAD, width, L.lineLines, Math.round(L.titleBig * 0.4), Math.round(L.titleBig * 0.3)) : null;
    m.lineStep = m.line ? Math.round(m.line.size * 1.3) : 0;
    m.when = L.when && data.when ? data.when : null;
    m.meter = showMeter && data.raisedPence > 0;
    m.target = m.meter && data.targetPence > 0;
    return m;
  }

  /* The heights of the stacked parts. */
  function heights(L, m) {
    var h = {};
    h.eyebrow = L.eyebrow * 2.4;
    h.title = m.title.lines.length * m.titleStep;
    h.line = m.line ? L.eyebrow * 1.2 + m.line.lines.length * m.lineStep : 0;
    h.when = m.when ? L.eyebrow * 2.2 : 0;
    h.meter = m.meter ? L.meterNum * (m.target ? 2.9 : 1.6) : 0;
    return h;
  }

  /* The eyebrow, title, line, date and meter, stacked from `y`, centred on cx. Returns where it ends. */
  function drawWords(ctx, L, m, h, cx, y, data) {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = C.goldSoft;
    ctx.font = "600 " + L.eyebrow + "px " + BODY;
    spaced(ctx, "FUNDRAISING FOR NBCC", cx, y + L.eyebrow, Math.round(L.eyebrow / 5));
    ctx.fillStyle = C.gold;
    ctx.fillRect(cx - 60, y + L.eyebrow * 1.75, 120, 3);
    y += h.eyebrow;

    ctx.fillStyle = C.cream;
    ctx.font = "800 " + m.title.size + "px " + HEAD;
    m.title.lines.forEach(function (l, i) {
      ctx.fillText(l, cx, y + m.title.size * 0.86 + i * m.titleStep);
    });
    y += h.title;

    if (m.line) {
      y += L.eyebrow * 1.2;
      ctx.fillStyle = C.goldSoft;
      ctx.font = "italic 400 " + m.line.size + "px " + HEAD;
      m.line.lines.forEach(function (l, i) {
        ctx.fillText(l, cx, y + m.line.size * 0.86 + i * m.lineStep);
      });
      y += m.line.lines.length * m.lineStep;
    }
    if (m.when) {
      ctx.fillStyle = C.cream;
      ctx.font = "400 " + Math.round(L.eyebrow * 1.05) + "px " + BODY;
      ctx.fillText(m.when, cx, y + L.eyebrow * 1.7);
      y += h.when;
    }
    if (m.meter) {
      var num = L.meterNum;
      ctx.fillStyle = C.cream;
      ctx.font = "800 " + num + "px " + HEAD;
      var numY = y + num * 1.15;
      ctx.fillText(money(data.raisedPence) + " raised", cx, numY);
      if (m.target) {
        var barW = Math.min(760, num * 9.5);
        var barH = Math.round(num * 0.38);
        var barY = numY + num * 0.42;
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
        ctx.font = "400 " + Math.round(num * 0.45) + "px " + BODY;
        ctx.fillText("of " + money(data.targetPence) + " target", cx, barY + barH + num * 0.72);
      }
      y += h.meter;
    }
    return y;
  }

  /* The address in a cream pill, its top at y, centred on cx. Returns its height. */
  function drawPill(ctx, data, cx, y, maxWidth, size) {
    var words = data.linkWords || "nbcc.scot";
    var pf = fit(ctx, words, "600 {s}px " + BODY, maxWidth - 90, 1, size, Math.round(size * 0.6));
    ctx.font = "600 " + pf.size + "px " + BODY;
    var text = pf.lines[0] || words;
    var pw = Math.min(maxWidth, ctx.measureText(text).width + 90);
    var ph = pf.size + 44;
    ctx.fillStyle = C.cream;
    roundRect(ctx, cx - pw / 2, y, pw, ph, ph / 2);
    ctx.fill();
    ctx.fillStyle = C.maroon;
    ctx.textAlign = "center";
    ctx.fillText(text, cx, y + ph / 2 + pf.size * 0.36);
    return ph;
  }

  /* The charity statement, measured: one line if it fits, else two. top: how far above the last
     line's baseline its first line starts. */
  function statementLines(ctx, data, maxWidth, size) {
    var s = fit(ctx, data.statement || STATEMENT, "400 {s}px " + BODY, maxWidth, 2, size, Math.round(size * 0.75));
    s.step = Math.round(s.size * 1.35);
    s.top = (s.lines.length - 1) * s.step + s.size;
    return s;
  }

  /* The charity statement, small, centred at the foot, its last line on `baseline`. */
  function drawStatement(ctx, s, cx, baseline) {
    ctx.fillStyle = "rgba(248,245,238,0.8)";
    ctx.font = "400 " + s.size + "px " + BODY;
    ctx.textAlign = "center";
    s.lines.forEach(function (l, i) {
      ctx.fillText(l, cx, baseline - (s.lines.length - 1 - i) * s.step);
    });
  }

  function drawTall(ctx, kind, data, logo, showMeter) {
    var size = SIZES[kind];
    var W = size.w;
    var H = size.h;
    var L = TALL[kind];
    var cx = W / 2;
    // The statement sits at the foot, and the address pill just above it.
    var stmt = statementLines(ctx, data, W - 150, L.stmt);
    var pillY = H - L.stmtFoot - stmt.top - 28 - (L.pillText + 44);
    var gapUnder = 40;
    var m = measure(ctx, data, L, W - 200, showMeter);
    var h = heights(L, m);
    var room = function () {
      return pillY - L.top - 40 - h.eyebrow - h.title - h.line - h.when - (h.meter ? h.meter + gapUnder : 0) - gapUnder;
    };
    // The logo takes what is left, up to its biggest; if even its smallest will not fit, the meter goes.
    if (room() < L.minLogo && h.meter) {
      m.meter = false;
      h.meter = 0;
    }
    var logoSize = Math.max(L.minLogo, Math.min(L.maxLogo, room()));
    // Whatever is still spare is shared above and below the words.
    var spare = Math.max(0, room() - logoSize);
    var y = L.top + spare * 0.35;
    if (logo) ctx.drawImage(logo, cx - logoSize / 2, y, logoSize, logoSize);
    y += logoSize + 40;
    y = drawWords(ctx, L, m, h, cx, y, data);
    if (L.caption) {
      ctx.fillStyle = C.goldSoft;
      ctx.font = "400 30px " + BODY;
      ctx.fillText(data.linkKind === "page" ? "Give on my page" : "Find out more", cx, pillY - 26);
    }
    drawPill(ctx, data, cx, pillY, W - 160, L.pillText);
    drawStatement(ctx, stmt, cx, H - L.stmtFoot);
  }

  function drawWide(ctx, kind, data, logo, showMeter) {
    var size = SIZES[kind];
    var W = size.w;
    var H = size.h;
    var L = WIDE[kind];
    var stmtBand = L.stmt * 3.2;
    var top = L.pad;
    var bottom = H - L.pad - stmtBand;
    var logoSize = Math.min(L.logo, bottom - top);
    var logoX = L.pad + 24;
    if (logo) ctx.drawImage(logo, logoX, top + (bottom - top - logoSize) / 2, logoSize, logoSize);
    var x0 = logoX + logoSize + L.gap;
    var x1 = W - L.pad - 24;
    var cx = (x0 + x1) / 2;
    var width = x1 - x0;
    var m = measure(ctx, data, L, width, showMeter);
    var h = heights(L, m);
    var pillH = L.pillText + 44;
    var total = function () {
      return h.eyebrow + h.title + h.line + h.when + (h.meter ? h.meter + 24 : 0) + 30 + pillH;
    };
    if (total() > bottom - top && h.meter) {
      m.meter = false;
      h.meter = 0;
    }
    var y = top + Math.max(0, (bottom - top - total()) / 2);
    y = drawWords(ctx, L, m, h, cx, y, data);
    drawPill(ctx, data, cx, y + (h.meter ? 24 : 0) + 30, width, L.pillText);
    drawStatement(ctx, statementLines(ctx, data, W - L.pad * 4, L.stmt), W / 2, H - L.pad * 0.75);
  }

  function draw(canvas, kind, data, logo, showMeter) {
    var size = SIZES[kind];
    var ctx = canvas.getContext("2d");
    if (!ctx || !size) return false;
    background(ctx, size.w, size.h);
    if (WIDE[kind]) drawWide(ctx, kind, data, logo, showMeter);
    else drawTall(ctx, kind, data, logo, showMeter);
    return true;
  }

  // --- a zip of every picture, with no library -----------------------------------------------------

  var CRC_TABLE = null;
  /* The standard CRC32 (as zip uses), of a Uint8Array. */
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  /* A zip of the files, each stored whole: [{ name, bytes }] in, a Uint8Array out. */
  function makeZip(files, when) {
    var d = when || new Date();
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    var date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    var enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
    var parts = [];
    var central = [];
    var offset = 0;
    files.forEach(function (f) {
      var name = enc ? enc.encode(f.name) : new Uint8Array(String(f.name).split("").map(function (ch) { return ch.charCodeAt(0) & 0xff; }));
      var crc = crc32(f.bytes);
      var head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true);
      head.setUint16(4, 20, true);
      head.setUint16(6, 0x0800, true); // names in UTF-8
      head.setUint16(8, 0, true); // stored
      head.setUint16(10, time, true);
      head.setUint16(12, date, true);
      head.setUint32(14, crc, true);
      head.setUint32(18, f.bytes.length, true);
      head.setUint32(22, f.bytes.length, true);
      head.setUint16(26, name.length, true);
      head.setUint16(28, 0, true);
      var cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, time, true);
      cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, f.bytes.length, true);
      cd.setUint32(24, f.bytes.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(42, offset, true);
      parts.push(new Uint8Array(head.buffer), name, f.bytes);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + f.bytes.length;
    });
    var cdSize = central.reduce(function (n, p) { return n + p.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    var all = parts.concat(central, [new Uint8Array(end.buffer)]);
    var out = new Uint8Array(all.reduce(function (n, p) { return n + p.length; }, 0));
    var at = 0;
    all.forEach(function (p) {
      out.set(p, at);
      at += p.length;
    });
    return out;
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

  function blobBytes(win, blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    return new Promise(function (resolve, reject) {
      var r = new win.FileReader();
      r.onload = function () { resolve(new Uint8Array(r.result)); };
      r.onerror = reject;
      r.readAsArrayBuffer(blob);
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

    function nameFor(kind) {
      return "nbcc-" + (data.slug || "fundraiser") + "-" + kind + ".png";
    }

    var failed = function () {
      say("Sorry, we could not make that picture in this browser. Try another browser, or ask us and we will send it.");
    };

    function hand(href, name, revoke) {
      var a = doc.createElement("a");
      a.href = href;
      a.download = name;
      doc.body.appendChild(a);
      a.click();
      doc.body.removeChild(a);
      if (revoke) win.setTimeout(revoke, 30000);
      say("Saved " + name + ". Look in your downloads.");
    }

    function handBlob(blob, name) {
      var url = win.URL.createObjectURL(blob);
      hand(url, name, function () {
        win.URL.revokeObjectURL(url);
      });
    }

    function save(kind) {
      var canvas = doc.querySelector('canvas[data-social="' + kind + '"]');
      if (!canvas) return;
      var name = nameFor(kind);
      try {
        if (canvas.toBlob) {
          canvas.toBlob(function (blob) {
            if (!blob) return failed();
            handBlob(blob, name);
          }, "image/png");
        } else {
          hand(canvas.toDataURL("image/png"), name, null);
        }
      } catch (e) {
        failed();
      }
    }

    /* Every size drawn afresh on a canvas of its own (so it works on a page with none showing), as
       PNGs in one zip. */
    function saveZip() {
      say("Making your pictures, one moment.");
      var made = ORDER.map(function (kind) {
        return new Promise(function (resolve, reject) {
          var canvas = doc.createElement("canvas");
          canvas.width = SIZES[kind].w;
          canvas.height = SIZES[kind].h;
          if (!draw(canvas, kind, data, logo, showMeter()) || !canvas.toBlob) return reject(new Error("no canvas"));
          canvas.toBlob(function (blob) {
            if (!blob) return reject(new Error("no picture"));
            blobBytes(win, blob).then(function (bytes) {
              resolve({ name: nameFor(kind), bytes: bytes });
            }, reject);
          }, "image/png");
        });
      });
      return Promise.all(made)
        .then(function (files) {
          var zip = makeZip(files, new Date());
          handBlob(new win.Blob([zip], { type: "application/zip" }), "nbcc-" + (data.slug || "fundraiser") + "-pictures.zip");
        })
        .catch(function () {
          failed();
        });
    }

    Array.prototype.forEach.call(doc.querySelectorAll("[data-social-download]"), function (btn) {
      btn.addEventListener("click", function () {
        save(btn.getAttribute("data-social-download"));
      });
    });
    Array.prototype.forEach.call(doc.querySelectorAll("[data-social-zip]"), function (btn) {
      btn.addEventListener("click", function () {
        btn.disabled = true;
        saveZip().then(function () {
          btn.disabled = false;
        });
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
    return { ready: ready, draw: drawAll, save: save, saveZip: saveZip };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initSocial: initSocial, wrap: wrap, money: money, crc32: crc32, makeZip: makeZip, SIZES: SIZES };
  } else {
    initSocial(document, window);
  }
})();
