// Charity Site — shared page script (REQ-001 scaffold).
//
// Intentionally tiny: it only flags that JS is active so later requirements
// (navigation toggles, form handling, and so on — REQ-002, REQ-003, REQ-010+)
// can progressively enhance the static markup. Add shared behaviour here; never
// inline a script block in a page.
(function () {
  "use strict";
  document.documentElement.dataset.js = "ready";
})();
