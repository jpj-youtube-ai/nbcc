import { elfPage, escapeHtml } from "./shell";

// NBCC Elf Detective School: signing in to Detective HQ, and the page Stripe sends people back to
// after paying (wave 1 plan, Task 6). Plain forms, no script needed: the email box asks for a code,
// the code box signs in. Unit tested in test/unit/elf-page-sign-in.test.ts.

export interface SignInView {
  /** "email": ask for a code. "code": type the code that was sent. */
  stage: "email" | "code";
  email?: string;
  /** A line above the form: what happened, or what went wrong. */
  message?: string;
  error?: boolean;
}

export function renderSignInPage(view: SignInView): string {
  const email = escapeHtml(view.email ?? "");
  const message = view.message
    ? `<p class="elf-sign-in__message${view.error ? " is-error" : " is-ok"}" role="${view.error ? "alert" : "status"}">${escapeHtml(view.message)}</p>`
    : "";
  const form =
    view.stage === "email"
      ? `<form class="elf-sign-in" method="post" action="/api/elf/sign-in/request">
          <div class="elf-field"><label for="elf-sign-in-email">Your email</label>
          <input id="elf-sign-in-email" name="email" type="email" autocomplete="email" maxlength="200" required value="${email}" /></div>
          <p><button class="btn btn-primary" type="submit">Send me a code</button></p>
          <p class="elf-hint">Use the email you enrolled with. We send a 6 digit code that works for 10 minutes.</p>
        </form>`
      : `<form class="elf-sign-in" method="post" action="/api/elf/sign-in">
          <input type="hidden" name="email" value="${email}" />
          <div class="elf-field"><label for="elf-sign-in-code">The 6 digit code we emailed to ${email || "you"}</label>
          <input id="elf-sign-in-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required /></div>
          <p><button class="btn btn-primary" type="submit">Sign in</button></p>
          <p class="elf-hint"><a href="/elf/sign-in">Use a different email, or send a new code</a></p>
        </form>`;
  const main = `
  <section class="section page-top elf-sign-in-top" aria-labelledby="elf-sign-in-heading">
    <div class="wrap">
      <h1 id="elf-sign-in-heading" class="h-xl">Sign in to Detective HQ</h1>
      ${message}
      ${form}
      <p class="elf-hint">Not enrolled yet? <a href="/elf/join">Enrol your detectives</a>.</p>
    </div>
  </section>`;
  return elfPage({
    title: "Sign in to Detective HQ",
    description: "Sign in to NBCC Elf Detective School's Detective HQ.",
    cta: { href: "/elf", label: "The calendar" },
    home: "/elf",
    main,
  });
}

export interface WelcomeView {
  /** "checking": the payment is not settled yet, so the page looks again by itself. "done": it is,
   *  but this browser is not signed in (it was not the one that paid, or the account already existed). */
  state: "checking" | "done";
}

export function renderWelcomePage(view: WelcomeView): string {
  const checking = view.state === "checking";
  const main = checking
    ? `
  <section class="section page-top elf-welcome-top" aria-labelledby="elf-welcome-heading">
    <div class="wrap">
      <h1 id="elf-welcome-heading" class="h-xl">We are just checking your payment</h1>
      <p class="lede">This takes a few seconds. The page will carry on by itself.</p>
      <p class="elf-hint">Taking a while? Your welcome email will arrive soon, and you can <a href="/elf/sign-in">sign in</a> from there.</p>
    </div>
  </section>`
    : `
  <section class="section page-top elf-welcome-top" aria-labelledby="elf-welcome-heading">
    <div class="wrap">
      <h1 id="elf-welcome-heading" class="h-xl">Thank you, detectives enrolled!</h1>
      <p class="lede">Check your email: your welcome is on its way, with each detective's badge number.</p>
      <p><a class="btn btn-primary" href="/elf/sign-in">Sign in to Detective HQ</a></p>
    </div>
  </section>`;
  const page = elfPage({
    title: checking ? "Checking your payment" : "Thank you",
    description: "Thank you for enrolling your detectives in NBCC Elf Detective School.",
    cta: { href: "/elf", label: "The calendar" },
    home: "/elf",
    main,
  });
  return checking ? page.replace("<head>", '<head>\n<meta http-equiv="refresh" content="3" />') : page;
}
