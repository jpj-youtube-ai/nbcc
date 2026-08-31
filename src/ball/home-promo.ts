// TASK-313: the Festive Ball promotion on the home page. Pure string transform — no pool, no
// config, no clock — mirroring renderSupportersPage in src/routes/site.ts.
//
// Why this exists at all: the printed magazine advert carries a QR code pointing at
// nbcc.scot, NOT at /ball, and the panel around it says "TICKETS AND TABLES NOW ON SALE". So
// on launch morning a stranger scans, lands on the HOME page, and has a few seconds to find a
// way to buy. Without this block every scan is a dead end.
//
// The critical property: when the gate is shut this returns the template BYTE FOR BYTE. The
// promotion is not hidden with CSS, it is simply never rendered — there is nothing in the page
// source for anyone to find before launch. That is what lets the whole thing be built, merged
// and deployed days early and switched on with one toggle.

export interface HomePromoInput {
  gateOpen: boolean;
}

// Styles ride along inline rather than joining assets/css/styles.css: donate.html sits about
// 369 bytes under its enforced first-paint budget (test/unit/perf-budget.test.ts) and that is
// the donation money path. Inline also means these bytes cost nothing while the gate is shut,
// and add no extra HTTP request when it is open.
const PROMO_STYLES = `<style>
  /* MARGIN, not padding, to clear the fixed nav. Padding is inside the box, so the navy
     background painted UP behind the header — and the home page nav is transparent until you
     scroll, which left grey nav links and the red NBCC logo sitting on a dark band. A margin
     starts the band BELOW the nav instead. The ticker's own height is already reserved by
     body.has-ticker, so this must clear the nav only or it double-counts. */
  .ball-banner{background:#0B1020;color:#F2EEE4;text-decoration:none;display:block;
    margin-top:var(--nav-h);padding:14px 0}
  .ball-banner .wrap{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;
    gap:6px 18px;text-align:center}
  .ball-banner b{font-family:"Playfair Display",Georgia,serif;font-weight:600;font-size:1.05rem;
    color:#E4C87A}
  .ball-banner span{font-size:.92rem;color:rgba(242,238,228,.78)}
  .ball-banner em{font-style:normal;font-weight:600;color:#F2EEE4;white-space:nowrap}
  .ball-banner:hover em{text-decoration:underline}
  /* The banner now clears the fixed nav, so the hero must not do it a second time. */
  .ball-banner + .hero{padding-top:clamp(20px,3vw,38px)}
  .ball-home-feature{background:#0B1020;color:#F2EEE4;
    background-image:radial-gradient(110% 80% at 50% -10%,rgba(233,210,150,.16) 0%,rgba(233,210,150,.05) 40%,transparent 74%);
    padding:clamp(40px,6vw,72px) 0}
  .ball-home-feature .wrap{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);
    gap:clamp(24px,4vw,56px);align-items:center}
  @media(max-width:820px){.ball-home-feature .wrap{grid-template-columns:1fr}}
  .ball-home-feature img{display:block;width:100%;height:auto}
  .ball-home-copy{display:flex;flex-direction:column;gap:14px;align-items:flex-start}
  .ball-home-copy .eyebrow{color:#E4C87A}
  .ball-home-copy h2{font-family:"Playfair Display",Georgia,serif;font-weight:600;margin:0;
    font-size:clamp(1.5rem,3vw,2.1rem);line-height:1.15;color:#F2EEE4}
  .ball-home-copy p{margin:0;color:rgba(242,238,228,.78);line-height:1.7;max-width:46ch}
  .ball-home-copy .btn{background:#E4C87A;color:#241B06;border:1px solid #E4C87A;font-weight:600}
  .ball-home-copy .btn:hover{background:#F0DCA0;border-color:#F0DCA0}
</style>`;

const BANNER = `      <a class="ball-banner" href="/ball">
        <span class="wrap">
          <b>A Night to Remember</b>
          <span>Festive Ball, Saturday 7 November 2026, The Park Hotel, Kilmarnock</span>
          <em>Tickets now on sale &rarr;</em>
        </span>
      </a>
`;

const FEATURE = `      <section class="ball-home-feature" aria-labelledby="ball-home-heading">
        <div class="wrap">
          <a href="/ball" aria-hidden="true" tabindex="-1">
            <img src="/assets/img/ball-lockup.svg" alt="" width="1306" height="491" loading="lazy" decoding="async" />
          </a>
          <div class="ball-home-copy">
            <span class="eyebrow">An evening in aid of NBCC</span>
            <h2 id="ball-home-heading">Join us for A Night to Remember.</h2>
            <p>
              Saturday 7 November 2026 at The Park Hotel, Kilmarnock. Dinner, live music and a
              charity auction, hosted by Michelle McManus. Tickets are &pound;100, tables of ten
              &pound;1,000, and because <a href="https://thedesignerrooms.com/" target="_blank"
              rel="noopener">The Designer Rooms</a> is covering the cost of the evening, your
              ticket funds NBCC's work.
            </p>
            <a class="btn" href="/ball">Book tickets</a>
          </div>
        </div>
      </section>
`;

const NAV_ANCHOR = '<li><a href="/supporters">Supporters</a></li>';
const MAIN_ANCHOR = '<main class="site-main home" id="main" tabindex="-1">';
const AFTER_HERO_ANCHOR = '<section class="section tint" aria-label="What we do">';

export function renderHomePromo(template: string, input: HomePromoInput): string {
  if (!input.gateOpen) return template;
  // Idempotent: rendering an already-promoted page must not double it up.
  if (template.includes("ball-home-feature")) return template;

  let html = template;

  // The nav link goes in at launch and comes out after 7 November — people come back to buy
  // later and will not remember the URL.
  html = html.replace(
    NAV_ANCHOR,
    NAV_ANCHOR + '\n            <li><a href="/ball">Festive Ball</a></li>',
  );

  html = html.replace("</head>", PROMO_STYLES + "\n  </head>");
  html = html.replace(MAIN_ANCHOR, MAIN_ANCHOR + "\n" + BANNER);

  // Below the hero, not instead of it: the hero is doing a different job, and replacing its
  // call to action would trade donations for ticket clicks.
  const indented = "      " + AFTER_HERO_ANCHOR;
  html = html.replace(indented, FEATURE + indented);

  return html;
}
