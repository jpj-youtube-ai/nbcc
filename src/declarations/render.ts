// Pure server-side rendering for the token-scoped Gift Aid declaration page (TASK-076/
// REQ-048). Takes the gift-aid.html template + context and returns HTML — no pool/config/
// clock, so it is unit-testable DB-free. GET renders the form (verbatim wording + the
// donor's token in the form action); a completed/invalid link or a successful POST replaces
// the form region with a message, reusing the same page shell (nav/footer/head).

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The form region between the markers in gift-aid.html — replaced wholesale for a message
// state. The template keeps a real default statement so the static file passes copy guards.
const REGION_RE = /<!--GIFTAID_REGION_START-->[\s\S]*?<!--GIFTAID_REGION_END-->/;

// Render the declaration form: inject the donor's token into the form action and the exact
// verbatim HMRC wording this donation will record (escaped).
export function renderGiftAidForm(
  template: string,
  context: { token: string; wordingSnapshot: string },
): string {
  return template
    .replace("/api/gift-aid/__GIFT_AID_TOKEN__", `/api/gift-aid/${encodeURIComponent(context.token)}`)
    .replace(
      /(<p class="giftaid-statement" id="giftAidStatement">)[\s\S]*?(<\/p>)/,
      `$1${escapeHtml(context.wordingSnapshot)}$2`,
    );
}

// Replace the form region with a message card (an already-completed / invalid link, or a
// post-submit success). Keeps the page shell so the donor stays on a branded page.
export function renderGiftAidMessage(
  template: string,
  message: { heading: string; body: string },
): string {
  const card =
    `<!--GIFTAID_REGION_START--><div class="giftaid-panel card reveal" data-region="giftaid">` +
    `<h2>${escapeHtml(message.heading)}</h2><p>${escapeHtml(message.body)}</p>` +
    `<div class="giftaid-actions"><a class="btn btn-primary" href="/">Back to home</a></div>` +
    `</div><!--GIFTAID_REGION_END-->`;
  return template.replace(REGION_RE, card);
}
