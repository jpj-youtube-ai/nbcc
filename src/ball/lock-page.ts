import { CHARITY_NAME, OSCR_NUMBER } from "../legal/registration";

// TASK-313: the password screen shown at /ball before launch. A standalone document on
// purpose — it must not leak a single detail of the page behind it, so it shares no markup
// with ball.html. Mirrors src/newsletter/document-page.ts (self-contained, noindex, inline
// styles) rather than pulling in the site bundle for one form.

export function renderBallLockPage(options: { error?: boolean } = {}): string {
  const error = options.error
    ? '<p class="err" role="alert">That password did not match. Try again, or ask whoever sent you the link.</p>'
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>A Night to Remember | ${CHARITY_NAME}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: #0B1020;
    background-image: radial-gradient(120% 90% at 50% -10%, rgba(233,210,150,.16) 0%, rgba(233,210,150,.05) 38%, transparent 72%);
    color: #F2EEE4;
    font-family: "Poppins", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .card { width: 100%; max-width: 420px; text-align: center; display: flex; flex-direction: column; gap: 22px; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-weight: 600; font-size: 1.6rem; margin: 0; letter-spacing: .01em; }
  .eyebrow { font-size: .72rem; letter-spacing: .18em; text-transform: uppercase; color: #E4C87A; margin: 0; font-weight: 600; }
  p.lede { margin: 0; font-size: .95rem; line-height: 1.7; color: rgba(242,238,228,.74); }
  form { display: flex; flex-direction: column; gap: 12px; }
  label { text-align: left; font-size: .82rem; font-weight: 600; }
  input {
    font: inherit; padding: 12px 14px; border-radius: 10px; width: 100%;
    border: 1px solid rgba(233,210,150,.28); background: rgba(255,255,255,.04); color: inherit;
  }
  input:focus-visible { outline: 3px solid #E4C87A; outline-offset: 1px; }
  button {
    font: inherit; font-weight: 600; cursor: pointer; padding: 12px 20px; border-radius: 999px;
    border: 1px solid #E4C87A; background: #E4C87A; color: #241B06;
  }
  button:hover { background: #F0DCA0; }
  .err { margin: 0; font-size: .88rem; color: #F0A8B2; }
  .foot { margin: 0; font-size: .75rem; color: rgba(242,238,228,.5); line-height: 1.6; }
  a { color: #E4C87A; }
</style>
</head>
<body>
  <main class="card">
    <p class="eyebrow">Not public yet</p>
    <h1>A Night to Remember</h1>
    <p class="lede">
      This page is still being finished. If you have been given a password to preview it,
      enter it below.
    </p>
    ${error}
    <form method="post" action="/ball/unlock">
      <label for="pw">Password</label>
      <input id="pw" name="password" type="password" autocomplete="current-password" autofocus required />
      <button type="submit">View the page</button>
    </form>
    <p class="foot">
      ${CHARITY_NAME} is a Scottish Charitable Incorporated Organisation, charity number
      ${OSCR_NUMBER}. Looking for us? <a href="/">nbcc.scot</a>
    </p>
  </main>
</body>
</html>`;
}
