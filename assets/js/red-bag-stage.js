// Fill a Red Bag, on its own stage (src/red-bag/stage.ts draws the band): a small working taste of the
// real page, with the real drawings, prices, status lines and elf's notes, all from the catalogue
// (red-bag-catalogue.js), which has read the list published for /fill out of the page. It fills itself
// as a demonstration until someone taps, then it is theirs, and what they chose goes with them to the
// real page as an address. The demonstration never carries. Nothing moves by itself for people who ask
// for less motion, and the taps still work.
(function () {
  var band = document.getElementById('fillBand');
  var rb = window.NBCCRedBag;
  if (!band || !rb) return;

  // A list on the page that cannot be used: no tiles, and the button still goes to /fill. Never the
  // catalogue's own prices beside a real page that shows different ones.
  if (document.getElementById(rb.LIST_DATA_ID) && !rb.useListFrom(document)) return;

  var MOST_TILES = 8;
  // The tiles, in order: these first, and whatever else is on the list after them, in the list's order.
  var FIRST = ['toy', 'headphones', 'blanket', 'insulated-cup', 'pyjamas', 'hat-gloves', 'book', 'socks'];
  // The order the demonstration uses: on the original list these come to £50 exactly.
  var DEMO_FIRST = ['toy', 'headphones', 'socks', 'blanket', 'insulated-cup', 'pyjamas', 'hat-gloves', 'book'];
  // Where things sit in the bag: across, down, tilt. Lowest and nearest first, then piling up.
  var SLOTS = [[50, 7, -3], [28, 8, -13], [72, 7, 12], [39, -3, -7], [62, -4, 8], [50, -13, 2], [25, -5, -19], [77, -6, 17]];
  var STEP_MS = 1000, FLY_MS = 620, HOLD_FULL_MS = 5600, HOLD_EMPTY_MS = 1300, NOTE_MS = 1700;

  // Plain maps: a key on a list is staff's, and must never meet anything a normal object already has.
  var items = Object.create(null);
  var drawn = rb.items().filter(function (i) { return rb.artKey(i.key); });
  drawn.forEach(function (i) { items[i.key] = i; });

  var KEYS = FIRST.filter(function (k) { return items[k]; });
  drawn.forEach(function (i) {
    if (KEYS.length < MOST_TILES && KEYS.indexOf(i.key) === -1) KEYS.push(i.key);
  });
  var DEMO = DEMO_FIRST.filter(function (k) { return items[k]; }).concat(KEYS.filter(function (k) { return DEMO_FIRST.indexOf(k) === -1; }));
  if (!KEYS.length) return;

  var still = !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var stage = document.getElementById('fbStage');
  var wob = document.getElementById('fbWob');
  var peeks = document.getElementById('fbPeeks');
  var sum = document.getElementById('fbSum');
  var status = document.getElementById('fbStatus');
  var note = document.getElementById('fbNote');
  var elf = document.getElementById('fbElf');
  var tilesBox = document.getElementById('fbTiles');
  var again = document.getElementById('fbAgain');
  var pauseBtn = document.getElementById('fbPause');
  var night = document.getElementById('fbNight');
  var bulbs = [].slice.call(band.querySelectorAll('.bulb'));
  var go = document.getElementById('fbGo');
  var fillPage = go.getAttribute('href');

  var total = 0;      // what has landed in the bag
  var promised = 0;   // what has landed, plus whatever is still in the air
  var placed = 0;
  var earlier = 0;    // pence in bags already filled
  var carry = Object.create(null); // what the visitor chose, across bags: this goes with them to the real page
  var round = 0;      // goes up each time the bag is emptied
  var counts = Object.create(null);
  var tiles = Object.create(null);
  var demo = !still;
  var paused = false;
  var inView = false;
  var timer = null;
  var noteTimer = null;
  var lastNote = '';

  KEYS.forEach(function (key) {
    var it = items[key];
    var name = it.name.replace(/\s*\(.*\)/, '') || it.name;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'fb-tile';
    b.setAttribute('aria-label', 'Pop ' + name.toLowerCase() + ' in the bag, ' + rb.pounds(it.pence));
    // The drawing is the catalogue's own markup; the name and price go in as words.
    b.insertAdjacentHTML('beforeend', rb.art(key, 'fb-tile-art', 44));
    var label = document.createElement('span');
    label.className = 'fb-tile-name';
    label.textContent = name;
    var price = document.createElement('b');
    price.className = 'fb-tile-price';
    price.textContent = rb.pounds(it.pence);
    var count = document.createElement('i');
    count.className = 'fb-count';
    count.setAttribute('aria-hidden', 'true');
    b.appendChild(label);
    b.appendChild(price);
    b.appendChild(count);
    b.addEventListener('click', function () { tapped(key); });
    tilesBox.appendChild(b);
    tiles[key] = b;
  });
  band.querySelector('.fb-try').hidden = false;

  function fill() { return Math.min(1, total / rb.BAG_VALUE_PENCE); }

  function say() {
    sum.textContent = rb.pounds(total);
    var all = earlier + total;
    status.textContent = rb.statusLine(total >= rb.BAG_VALUE_PENCE ? Math.floor(all / rb.BAG_VALUE_PENCE) * rb.BAG_VALUE_PENCE : all);
    stage.style.setProperty('--f', fill().toFixed(3));
    var lit = Math.floor(fill() * bulbs.length + 1e-9);
    bulbs.forEach(function (b, i) { b.classList.toggle('on', i < lit); });
  }

  function pop(el, frames, ms, easing) {
    if (still || !el.animate) return null;
    return el.animate(frames, { duration: ms, easing: easing || 'cubic-bezier(.22,1,.36,1)' });
  }

  function showNote(text) {
    lastNote = text;
    note.textContent = text;
    note.classList.add('show');
    pop(elf, [{ transform: 'translateY(16px)' }, { transform: 'translateY(0)' }], 420);
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { note.classList.remove('show'); }, NOTE_MS);
  }

  function place(key) {
    var slot = placed % SLOTS.length;
    var s = SLOTS[slot];
    var old = peeks.querySelector('[data-slot="' + slot + '"]');
    if (old) old.remove();
    var d = document.createElement('div');
    d.className = 'fb-peek';
    d.setAttribute('data-slot', slot);
    d.style.cssText = '--x:' + s[0] + '%;--y:' + s[1] + '%;--r:' + s[2] + 'deg;--z:' + (30 - slot);
    d.innerHTML = rb.art(key, '', 120);
    peeks.appendChild(d);
    pop(d, [{ translate: '0 46%', scale: '.8' }, { translate: '0 0', scale: '1' }], 460);
    placed += 1;
  }

  function land(key) {
    var first = total === 0;
    total += items[key].pence;
    counts[key] = (counts[key] || 0) + 1;
    var c = tiles[key].querySelector('.fb-count');
    c.textContent = counts[key];
    c.classList.add('on');
    place(key);
    say();
    pop(wob, [
      { transform: 'scale(1.05,.93) rotate(0deg)' },
      { transform: 'scale(.97,1.04) rotate(-1.6deg)', offset: .36 },
      { transform: 'scale(1.01,.99) rotate(1deg)', offset: .68 },
      { transform: 'none' },
    ], 560, 'ease-out');
    pop(sum, [{ transform: 'scale(1.26)' }, { transform: 'scale(1)' }], 380);
    spark(9);
    if (total >= rb.BAG_VALUE_PENCE) finished();
    else showNote(rb.noteFor({ kind: 'in', key: key, quantity: counts[key], step: 1, first: first }, lastNote, Math.random()));
  }

  function finished() {
    band.classList.add('full');
    clearTimeout(noteTimer);
    note.classList.remove('show');
    spark(120);
  }

  function fly(key) {
    var from = tiles[key].querySelector('.rb-art').getBoundingClientRect();
    var to = stage.querySelector('.fb-bag').getBoundingClientRect();
    var size = from.width;
    var gx = to.left + to.width * .46, gy = to.top + to.height * .26;
    var dx = gx - (from.left + size / 2), dy = gy - (from.top + size / 2);
    var inScreen = from.top < window.innerHeight && from.bottom > 0 && to.top < window.innerHeight && to.bottom > 0;
    if (still || !document.body.animate || !inScreen) { land(key); return; }
    var c = document.createElement('div');
    c.className = 'fb-fly';
    c.style.cssText = 'left:' + from.left + 'px;top:' + from.top + 'px;width:' + size + 'px;height:' + size + 'px';
    c.innerHTML = rb.art(key, '', size);
    document.body.appendChild(c);
    var lift = Math.min(190, 70 + Math.abs(dx) * .24);
    var spin = dx > 0 ? 24 : -24;
    var mine = round;
    var a = c.animate([
      { transform: 'translate(0,0) rotate(0deg) scale(1)' },
      { transform: 'translate(' + dx * .52 + 'px,' + (dy * .52 - lift) + 'px) rotate(' + spin + 'deg) scale(1.9)', offset: .56 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(' + spin * 1.5 + 'deg) scale(1.3)' },
    ], { duration: FLY_MS, easing: 'cubic-bezier(.3,.05,.45,1)' });
    a.onfinish = function () { c.remove(); if (mine === round) land(key); };
  }

  function add(key) {
    // A full bag stays full until the next tap, which starts another. Nothing is lost while one is in the air.
    if (promised >= rb.BAG_VALUE_PENCE) {
      if (total < rb.BAG_VALUE_PENCE) return false;
      clearBag(true);
    }
    promised += items[key].pence;
    fly(key);
    return true;
  }

  // Their bag goes with them: the button says so, and the real page opens with the same things in it.
  function carryOn() {
    var bits = Object.keys(carry).map(function (k) { return k + ':' + carry[k]; });
    go.href = bits.length ? fillPage + '?bag=' + bits.join(',') : fillPage;
    go.textContent = bits.length ? 'Carry on with this bag' : 'Fill a Red Bag';
  }

  function clearBag(another) {
    earlier = another ? earlier + total : 0;
    if (!another) { carry = Object.create(null); counts = Object.create(null); carryOn(); }
    total = 0; promised = 0; placed = 0; round += 1;
    peeks.innerHTML = '';
    band.classList.remove('full');
    if (!another) Object.keys(tiles).forEach(function (k) { tiles[k].querySelector('.fb-count').classList.remove('on'); });
    clearTimeout(noteTimer);
    note.classList.remove('show');
    [].slice.call(document.querySelectorAll('.fb-fly')).forEach(function (f) { f.remove(); });
    say();
  }

  // ---- the demonstration: it stops for good at the first tap
  function step(i) {
    timer = null;
    if (!demo) return;
    if (paused || !inView) { timer = setTimeout(function () { step(i); }, 300); return; }
    if (promised >= rb.BAG_VALUE_PENCE) {
      timer = setTimeout(function () { clearBag(); timer = setTimeout(function () { step(0); }, HOLD_EMPTY_MS); }, HOLD_FULL_MS);
      return;
    }
    var key = DEMO[i % DEMO.length];
    var t = tiles[key];
    t.classList.add('press');
    setTimeout(function () { t.classList.remove('press'); }, 240);
    add(key);
    timer = setTimeout(function () { step(i + 1); }, STEP_MS);
  }

  function tapped(key) {
    if (demo) {
      demo = false;
      clearTimeout(timer);
      clearBag();
      status.setAttribute('aria-live', 'polite');
    }
    again.hidden = false;
    if (add(key)) {
      carry[key] = Math.min(rb.MAX_QUANTITY, (carry[key] || 0) + 1);
      carryOn();
    }
  }

  again.addEventListener('click', function () { clearBag(); again.hidden = true; tilesBox.querySelector('button').focus(); });

  // Pause holds the demonstration, the snow and the twinkling. It stays once the bag is the visitor's:
  // the snow carries on, so there is still something to hold. Taps work either way.
  pauseBtn.addEventListener('click', function () {
    paused = !paused;
    pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    band.classList.toggle('held', paused);
    if (!paused) wake();
  });

  // ---- the night sky: snow all the time, a shower of gold at each thing in the bag
  var sky = band.querySelector('.fb-sky');
  var ctx = sky.getContext && sky.getContext('2d');
  var W = 0, H = 0, flakes = [], stars = [], bits = [], running = false, last = 0;

  function size() {
    // A phone's address bar coming and going is a resize too: leave the snow alone for that.
    if (night.clientWidth === W && night.clientHeight === H) return;
    var r = Math.min(window.devicePixelRatio || 1, 2);
    W = night.clientWidth; H = night.clientHeight;
    sky.width = W * r; sky.height = H * r;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    var n = Math.round(Math.min(120, W / 12));
    flakes = [];
    for (var i = 0; i < n; i += 1) {
      var z = .35 + Math.random() * .65;
      flakes.push({ x: Math.random() * W, y: Math.random() * H, z: z, p: Math.random() * 6.28 });
    }
    stars = [];
    for (var j = 0; j < 34; j += 1) stars.push({ x: Math.random() * W, y: Math.random() * H * .6, r: .7 + Math.random() * 1.5, p: Math.random() * 6.28 });
  }

  function starShape(x, y, r, rot) {
    ctx.beginPath();
    for (var i = 0; i < 10; i += 1) {
      var a = rot + i * Math.PI / 5, q = i % 2 ? r * .42 : r;
      ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * q, y + Math.sin(a) * q);
    }
    ctx.closePath();
    ctx.fill();
  }

  function spark(n) {
    if (still || !ctx || paused) return;
    var s = stage.querySelector('.fb-bag').getBoundingClientRect(), b = night.getBoundingClientRect();
    var x = s.left - b.left + s.width * .46, y = s.top - b.top + s.height * .24;
    for (var i = 0; i < n; i += 1) {
      var a = -Math.PI / 2 + (Math.random() - .5) * (n > 20 ? 2.5 : 1.5);
      var v = (n > 20 ? 220 : 110) + Math.random() * (n > 20 ? 460 : 170);
      bits.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: (n > 20 ? 1.5 : .8) + Math.random() * .9, gold: Math.random() < .72, r: 3 + Math.random() * (n > 20 ? 7 : 4), o: Math.random() * 6, s: (Math.random() - .5) * 7 });
    }
    wake();
  }

  function draw(now) {
    if (!inView || paused) { running = false; return; }
    var dt = Math.min(.05, (now - last) / 1000 || 0);
    last = now;
    ctx.clearRect(0, 0, W, H);
    var i;
    for (i = 0; i < stars.length; i += 1) {
      var st = stars[i];
      ctx.fillStyle = 'rgba(244,201,93,' + (.3 + .5 * (.5 + .5 * Math.sin(now / 900 + st.p))).toFixed(3) + ')';
      starShape(st.x, st.y, st.r * 2.1, st.p);
    }
    ctx.fillStyle = 'rgb(248,245,238)';
    for (i = 0; i < flakes.length; i += 1) {
      var f = flakes[i];
      f.y += (16 + 44 * f.z) * dt;
      f.x += Math.sin(now / 1500 + f.p) * 12 * f.z * dt;
      if (f.y > H + 6) { f.y = -6; f.x = Math.random() * W; }
      ctx.globalAlpha = .22 + .6 * f.z;
      ctx.beginPath();
      ctx.arc(f.x, f.y, .8 + 2.4 * f.z, 0, 6.29);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (i = bits.length - 1; i >= 0; i -= 1) {
      var p = bits[i];
      p.t += dt;
      if (p.t > p.life) { bits.splice(i, 1); continue; }
      p.vy += 560 * dt; p.vx *= .992;
      p.x += p.vx * dt; p.y += p.vy * dt; p.o += p.s * dt;
      ctx.globalAlpha = Math.min(1, (p.life - p.t) * 2.4);
      ctx.fillStyle = p.gold ? '#F4C95D' : '#F8F5EE';
      starShape(p.x, p.y, p.r, p.o);
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }

  function wake() {
    if (running || still || !ctx || !inView || paused) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(draw);
  }

  function onScreen(yes) {
    inView = yes;
    if (inView) { band.classList.add('seen'); wake(); }
  }

  say();
  if (!still) {
    pauseBtn.hidden = false;
    if (ctx) { size(); window.addEventListener('resize', size); }
  } else {
    status.setAttribute('aria-live', 'polite');
  }
  if (typeof IntersectionObserver === 'undefined') onScreen(true);
  else new IntersectionObserver(function (es) { onScreen(es[0].isIntersecting); }, { threshold: .2 }).observe(band);
  if (demo) timer = setTimeout(function () { step(0); }, 500);
})();
