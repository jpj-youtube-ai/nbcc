// Fill a Red Bag: the thank you page, /fill/thank-you (fill-thank-you.html;
// docs/superpowers/specs/2026-10-04-fill-a-red-bag-design.md).
//
// Stripe brings the donor back here. The page is drawn by the server and reads as a plain thank you
// without this file. This:
//   - shows the total this tab remembered before leaving for Stripe (assets/js/red-bag.js left it
//     in sessionStorage), "every month" for a monthly donation, and the Gift Aid line when Gift Aid
//     was added. For show only: the server never trusts it. Missing or odd, the plain line stays;
//   - takes the payment's id out of the address bar at once;
//   - lands the focus on the heading;
//   - makes the picture to share, "I filled a Red Bag", which names no amount.
//
// Its own small file, so the thank you does not load the giving page's script. A classic
// <script defer>, exported under a CommonJS guard so it can be unit tested in jsdom.
(function () {
  "use strict";

  // What the giving page left in this tab's memory. Display only.
  var GIFT_KEY = "nbcc_red_bag_gift";
  // The giving page's public address, for sharing.
  var PAGE_URL = "https://nbcc.scot/fill";

  function each(list, fn) {
    Array.prototype.forEach.call(list, fn);
  }

  function setText(el, words) {
    if (el && el.textContent !== words) el.textContent = words;
  }

  function focusOn(el) {
    if (!el) return;
    try {
      el.focus({ preventScroll: false });
    } catch (e) {
      /* focus unavailable */
    }
  }

  function storage(win) {
    try {
      return win.sessionStorage || null;
    } catch (e) {
      return null;
    }
  }

  // The payment's id (session_id, which Stripe filled in) comes straight out of the address bar, so
  // it is never copied, shared, bookmarked or kept in the history. The total is what this tab
  // remembered before leaving for Stripe; missing or odd, the plain thank you stays.
  function initThanks(doc, win) {
    var rb = win && win.NBCCRedBag;
    var thanks = doc.querySelector("[data-rb-thanks]");
    if (!rb || !thanks) return null;
    var loc = win.location || {};
    if (/[?&](session_id|thanks)=/.test(String(loc.search || "")) && win.history && typeof win.history.replaceState === "function") {
      try {
        win.history.replaceState(null, "", loc.pathname);
      } catch (e) {
        /* the address stays as it is */
      }
    }
    var gift = null;
    var s = storage(win);
    if (s) {
      try {
        gift = JSON.parse(s.getItem(GIFT_KEY) || "null");
        s.removeItem(GIFT_KEY);
      } catch (e) {
        gift = null;
      }
    }
    var ok = gift && typeof gift.pence === "number" && isFinite(gift.pence) && gift.pence >= rb.MIN_PENCE && Math.floor(gift.pence) === gift.pence;
    var totalLine = thanks.querySelector("[data-rb-thanks-total]");
    var plain = thanks.querySelector("[data-rb-thanks-plain]");
    var aid = thanks.querySelector("[data-rb-thanks-giftaid]");
    if (ok && totalLine) {
      setText(thanks.querySelector("[data-rb-thanks-amount]"), rb.pounds(gift.pence) + (gift.monthly ? " every month" : ""));
      totalLine.hidden = false;
      if (plain) plain.hidden = true;
      if (aid && gift.giftAid === true) {
        setText(thanks.querySelector("[data-rb-thanks-giftaid-amount]"), rb.pounds(Math.round(gift.pence * 0.25)));
        aid.hidden = false;
      }
    }
    each(thanks.querySelectorAll(".rb-bag"), function (b) {
      b.classList.add("is-full");
    });
    // The page's one big heading is the thank you: the focus lands there on arrival.
    focusOn(doc.getElementById("rb-thanks-title"));
    initShare(doc, win, doc);
    return thanks;
  }

  // --- the picture to share: "I filled a Red Bag", and never an amount -----------------------------
  // The bag is the page's own drawing (src/red-bag/render.ts), tied and full.
  // Drawn on a canvas in the browser, the way the fundraisers' social pictures are
  // (assets/js/fundraise-social.js): no image library on the server, and nothing leaves the page
  // until the giver chooses to share or save it.
  var C = { cream: "#F8F5EE", crimson: "#C02238", maroon: "#800000", tan: "#D29C8A", tanSoft: "#F3E4DD", slate: "#333333", holly: "#1A531A" };

  function drawPicture(canvas, win) {
    var ctx = null;
    try {
      ctx = canvas.getContext("2d");
    } catch (e) {
      ctx = null;
    }
    if (!ctx || typeof win.Path2D !== "function") return false;
    var W = canvas.width;
    var H = canvas.height;
    ctx.fillStyle = C.cream;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = C.maroon;
    ctx.lineWidth = 6;
    ctx.strokeRect(36, 36, W - 72, H - 72);

    // The bag: the page's own drawing (src/red-bag/render.ts), full, four times the size.
    var k = 4.3;
    ctx.save();
    ctx.translate((W - 120 * k) / 2, 96);
    ctx.scale(k, k);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = C.maroon;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3.4;
    ctx.stroke(new win.Path2D("M44 36C44 10 88 10 88 36"));
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.cream;
    ctx.strokeStyle = C.tan;
    ctx.lineWidth = 1.2;
    var tissue = new win.Path2D("M22 38l9-13 8 9 9-14 9 13 9-12 8 11 9-9 7 15z");
    ctx.fill(tissue);
    ctx.stroke(tissue);
    var body = new win.Path2D("M12 36h96v88a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4z");
    ctx.fillStyle = C.crimson;
    ctx.fill(body);
    ctx.fillStyle = C.maroon;
    ctx.globalAlpha = 0.16;
    ctx.fill(new win.Path2D("M92 36h16v88a4 4 0 0 1-4 4H92z"));
    ctx.globalAlpha = 0.12;
    ctx.fill(new win.Path2D("M12 36h96v10H12z"));
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = C.maroon;
    ctx.lineWidth = 1;
    ctx.stroke(new win.Path2D("M12 46h96M92 46v82"));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.crimson;
    ctx.lineWidth = 3.4;
    ctx.stroke(new win.Path2D("M32 40C32 12 76 12 76 40"));
    ctx.fillStyle = C.maroon;
    ctx.beginPath();
    ctx.arc(32, 41, 2.2, 0, Math.PI * 2);
    ctx.arc(76, 41, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.textAlign = "center";
    ctx.fillStyle = C.crimson;
    ctx.font = '800 96px "Playfair Display", Georgia, serif';
    ctx.fillText("I filled a Red Bag", W / 2, 800);
    ctx.fillStyle = C.holly;
    ctx.fillRect(W / 2 - 150, 838, 300, 4);
    ctx.fillStyle = C.slate;
    ctx.font = '400 40px "Poppins", system-ui, sans-serif';
    ctx.fillText("Fill one too at nbcc.scot/fill", W / 2, 912);
    ctx.font = '400 26px "Poppins", system-ui, sans-serif';
    ctx.fillText("Night Before Christmas Campaign (NBCC). Scottish Charity SC047995.", W / 2, 984);
    return true;
  }

  function initShare(doc, win, thanks) {
    var box = thanks.querySelector("[data-rb-share]");
    var canvas = box ? box.querySelector("[data-rb-share-picture]") : null;
    if (!box || !canvas) return null;
    var status = box.querySelector("[data-rb-share-status]");
    var save = box.querySelector("[data-rb-share-save]");
    var send = box.querySelector("[data-rb-share-send]");
    var words = "I filled a Red Bag with NBCC. You can fill one too: " + PAGE_URL;

    function finish() {
      if (!drawPicture(canvas, win)) {
        canvas.hidden = true;
        return;
      }
      var url = "";
      try {
        url = canvas.toDataURL("image/png");
      } catch (e) {
        url = "";
      }
      if (save && url) {
        save.href = url;
        save.hidden = false;
      }
      var nav = win.navigator || {};
      if (send && typeof nav.share === "function" && typeof canvas.toBlob === "function" && typeof win.File === "function") {
        send.hidden = false;
        send.addEventListener("click", function () {
          canvas.toBlob(function (blob) {
            if (!blob) return;
            var file = new win.File([blob], "i-filled-a-red-bag.png", { type: "image/png" });
            var data = { text: words };
            if (typeof nav.canShare === "function" && nav.canShare({ files: [file] })) data.files = [file];
            nav.share(data).then(
              function () {
                setText(status, "Thank you for sharing.");
              },
              function () {
                /* they closed the share sheet: nothing to say */
              },
            );
          }, "image/png");
        });
      }
    }

    // The words are drawn in the page's own faces, so wait for them where the browser can say.
    var fonts = doc.fonts;
    if (fonts && typeof fonts.load === "function") {
      Promise.all([fonts.load('800 96px "Playfair Display"'), fonts.load('400 40px "Poppins"')]).then(finish, finish);
    } else {
      finish();
    }

    // Copy the link, shown only where copying works (as on a fundraiser's page).
    var copy = box.querySelector("[data-rb-copy-link]");
    var clip = win.navigator && win.navigator.clipboard;
    if (copy && clip && typeof clip.writeText === "function") {
      copy.hidden = false;
      copy.addEventListener("click", function () {
        clip.writeText(PAGE_URL).then(
          function () {
            setText(status, "Link copied. You can paste it anywhere.");
          },
          function () {
            setText(status, "Copying did not work here. The link is " + PAGE_URL);
          },
        );
      });
    }
    return box;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { initThanks: initThanks };
  } else {
    initThanks(document, window);
  }
})();
