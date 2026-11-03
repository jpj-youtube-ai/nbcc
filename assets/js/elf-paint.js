/* NBCC Elf Detective School: the painted layers of the dress-up elf. Written by
 * scripts/elf-paint/manifest.mjs: do not edit by hand. Read by assets/js/elf-wardrobe.js. */
(function () {
  "use strict";
  var PAINT = {"canvas":{"w":1024,"h":1536,"view":[-79,0,1182,1536]},"layers":{}};
  (function freeze(v) { if (v && typeof v === "object" && !Object.isFrozen(v)) { Object.freeze(v); for (var k in v) freeze(v[k]); } })(PAINT);
  if (typeof module !== "undefined" && module.exports) module.exports = PAINT;
  else window.NBCCElfPaint = PAINT;
})();
