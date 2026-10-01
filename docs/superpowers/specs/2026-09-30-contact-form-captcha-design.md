# A spam check on the contact form (Cloudflare Turnstile)

Date: 2026-09-30. Approved by Jaimie in chat, part by part ("Looks right", "Keep it, log a
warning", "Yes, write it up").

Updated 2026-10-01 after the code review (TASK-490):
- Cloudflare's script loads only once the visitor starts on the form.
- Cloudflare's reason decides, whatever the HTTP status.
- Only the web server needs the keys.
- The box is drawn again if the form gets narrower.
- The rollout cancels the merge's own deploy and re-runs it after the infra apply.

## Why

Bot spam is reaching Admin → Contact form. `postContact` (`src/routes/api.ts`) already has three
defences: the hidden `company` honeypot, a limit of five messages a minute per IP, and field
validation. Bots that post straight to `/api/contact` without loading the page, or that leave
hidden fields alone, pass all three. A check that a real browser completed a challenge stops them.

Cloudflare Turnstile, chosen over a self-hosted proof of work (it slows bots rather than detecting
them) and AWS WAF's CAPTCHA (it costs money and falls back to picture puzzles that older visitors
struggle with). Turnstile is free, almost never shows a puzzle, and NBCC already has a Cloudflare
account (the referral system uses it), so nobody signs up for anything.

## What visitors see

- A small Cloudflare box above the Send button, appearing once the visitor starts on the form (a
  tap or a key in any field): "Verifying…", then a tick. Managed mode, so almost everyone gets no
  puzzle; the check runs while they type.
- Sized to the room it has: Flexible when the form is at least 300px wide, Compact (150×140) when
  it is not, and drawn again at the size that fits if the form gets narrower (a phone turned
  upright). Flexible and Normal need 300px, and a 320px phone must never scroll sideways.
- Pressing Send before the tick: "One moment, we're still checking you're not a robot." Pressing
  it again: "Still checking you're not a robot. If this keeps happening, please email
  info@nbcc.scot." When Cloudflare shows a box to tick: "Please tick the box above Send to show
  you're not a robot." If Cloudflare's script cannot load: "The spam check could not load. Please
  try again in a moment, or email info@nbcc.scot.", and pressing Send tries to load it again.
  Nothing is sent and nothing is lost; the message stays in the form until there is a pass.
- A pass that fails, expires or is refused: "Please try again." The box resets and the typed
  message stays, as the form already does for any error.
- The box resets after every send, because each pass works once. When a held Send's pass arrives,
  the message changes to "Thank you for waiting. Please press Send again to send your message.",
  so a blank never reads as sent.
- JavaScript off: a note under the form, "This form needs JavaScript to check you're not a robot.
  You can email us at info@nbcc.scot instead." (Today a no-JavaScript send gets a raw error page.)
- The contact form only. The footer newsletter signup and My Story keep their own honeypots.

## What the server does

`POST /api/contact`, in this order:

1. **Honeypot** (unchanged). A filled `company` field gets 200 "sent", nothing stored, and
   Cloudflare is never called.
2. **Rate limit** (unchanged). Five a minute per IP, then 429.
3. **Turnstile** (new, only when the check is on). The pass arrives in the JSON body as
   `captchaToken`. The server sends it with the secret key and `req.ip` to
   `https://challenges.cloudflare.com/turnstile/v0/siteverify`, and waits at most 5 seconds.
   - **Passed:** carry on.
   - **The visitor's pass is refused** (missing, invalid, expired or already used:
     `missing-input-response`, `invalid-input-response`, `timeout-or-duplicate`, any other code
     not listed below, or a failure that gives no reason). Reply 400 with a `captcha` error and
     store nothing.
   - **The check itself cannot answer:** a network error, a timeout, an unreadable reply or an
     error status that names no reason, `internal-error`, `bad-request` (our own request was
     malformed), or our own secret rejected (`missing-input-secret`, `invalid-input-secret`).
     **Keep the message** and log a warning naming the reason. A genuine enquiry is never lost
     because the checker had a bad moment. That was Jaimie's decision. During such a moment a bot's
     message can get in too, still limited by steps 1 and 2.
   - Cloudflare names its reason in the body whatever the HTTP status (a rejected secret is a 400
     naming `invalid-input-secret`), so the codes decide and the status counts only when there
     are none.
4. **Validation** (unchanged). It comes after the check, so a bot without a valid pass learns
   nothing about what the form expects. `contactEnquirySchema` is a plain `z.object`, so the extra
   `captchaToken` field is dropped by the parse and never stored.
5. **Store** (unchanged).

**On only when configured.** The check is on when both `TURNSTILE_SITE_KEY` and
`TURNSTILE_SECRET_KEY` are set, and off when either is missing. Both matter: a secret without a
site key would refuse every message, because the page could not show the box. Local development
and the GitHub checks set neither, so they keep working with no call to Cloudflare, and the two
existing contact BDD scenarios are unchanged. The production web server must have both and refuses
to start without them (`src/index.ts`), so the check can never silently switch itself off there.
The scheduled jobs that load the same config (the backup, the reminders) do not need them.

**How the page learns the site key:** `GET /api/contact/captcha` answers `{ "siteKey": "…" }` when
the check is on and `{ "siteKey": null }` when it is off, the way the Stripe publishable key
reaches the donate page through an API. `assets/js/contact-captcha.js` asks on the contact page
only, and loads Cloudflare's script
(`https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`) and renders the box only
once the visitor starts on the form or presses Send. Someone who only reads the contact page never
contacts Cloudflare, and no other page, and no page in development or CI, loads anything from it.

## Pieces

- `src/clients/turnstile.ts`: one function that asks Cloudflare about a pass and answers
  `passed`, `refused` or `unavailable` (with the reason). It is the only code that knows
  Cloudflare's error codes.
- `postContact`: calls it between the rate limit and validation, when the check is on.
- `GET /api/contact/captcha`: the site key, or null.
- `assets/js/contact-captcha.js`, its own file on the contact page only, because `main.js` counts
  towards `donate.html`'s page weight. It fetches the site key and loads Cloudflare's script once
  the visitor starts on the form. It renders the box at the size that fits, and again if the form
  gets narrower. It holds Send without a pass, using `main.js`'s own form check, and resets the
  box after every send.
- `assets/js/main.js` (the contact form's existing handler): sends `captchaToken` with the
  message.
- `contact.html`: the box's container above Send, and the `<noscript>` note.
- `src/config/schema.ts` and `.env.example`: the two keys, optional outside production and
  required in it.
- Terraform (`infra/`): `TURNSTILE_SECRET_KEY` as a SecureString SSM parameter holding
  `REPLACE_ME` with `ignore_changes = [value]` (the Stripe secret's pattern); the task
  definition's `secrets` entry and the `exec_secrets` IAM policy for it; `TURNSTILE_SITE_KEY` as a
  plain task-definition `environment` value from a Terraform variable set in
  `infra/envs/production/main.tf` (it is public, like the Stripe publishable key). The
  `/add-config` skill covers these touch-points.
- `privacy.html`: the section below.
- `README.md`: the contact form section.

## Keys: Jaimie's part

1. In the existing Cloudflare account (the charity's, not a person's): Turnstile, then Add widget.
   Name it "nbcc.scot contact form", hostname `nbcc.scot` (a root domain covers `www.nbcc.scot`
   and every other subdomain), mode Managed.
2. The **site key** is public: every visitor's browser sees it. It can be pasted into chat.
3. The **secret key** never goes into chat or code. Jaimie pastes it into AWS in CloudShell with
   one `aws ssm put-parameter --overwrite` command, after the PR has created its slot.

## Privacy

`privacy.html` gains a short section. When the visitor starts filling in the contact form, it uses
Cloudflare Turnstile to check that the message comes from a person. Cloudflare receives the visitor's IP address and information about
their browser for that check, may keep a small amount of data in the browser (cookies and local
storage) for that purpose only, and does not use it for advertising. The lawful basis is the
charity's legitimate interest in keeping its inbox free of spam so real enquiries get answered. A
link goes to Cloudflare's Turnstile Privacy Addendum; the exact URL and wording are checked against
Cloudflare's own pages when the section is written. No cookie banner: Cloudflare's script loads
only once the visitor starts on the form, and its storage serves only the security of a form the
visitor has chosen to use, which is strictly necessary for that service.

## Rollout

1. Jaimie creates the widget and gives me the site key.
2. The PR merges. It touches `infra/`, so the production Infra apply runs straight after the merge
   (`/ship` step 9). The merge's own deploy reads the task definition from Terraform's state.
   If it ran before the apply, the new web server would start without the keys and refuse, and
   ECS would keep the old version running. So that deploy is cancelled before it registers
   anything, and re-run once the apply is green. The secret's slot then exists holding
   `REPLACE_ME`, so the box shows and every check reports our secret as invalid: messages are
   kept and warnings logged. No order of these steps can lose an enquiry.
3. Jaimie pastes the secret in CloudShell.
4. The running service is restarted on the same image so it reads the new value (the documented
   manual redeploy, or `aws ecs update-service --force-new-deployment`).
5. A real test message from a phone and from a desktop arrives in Admin → Contact form, and the
   logs show no captcha warnings.

## Tests

- **Unit, no network.**
  - The Turnstile client:
    - a pass;
    - every error code sorted into `refused` or `unavailable`;
    - a timeout;
    - a non-200 or unreadable reply;
    - a network error.
  - `postContact` with the check injected:
    - the honeypot short-circuits before any call to Cloudflare;
    - the rate limit runs before it too;
    - a refused pass gives 400 and stores nothing;
    - an unavailable check stores the message and logs an error;
    - with the check off, it behaves exactly as today;
    - `captchaToken` is never stored.
- **The page:**
  - `contact.html` has the box's container and the `<noscript>` note;
  - `contact-captcha.js` (jsdom, with `turnstile` stubbed) loads Cloudflare only once the visitor
    starts on the form and only when the site key comes back;
  - it holds Send with the right message, takes it back once a pass arrives, and agrees with
    `main.js`'s form check;
  - it redraws the box when the form gets narrower, and resets the box after a send;
  - `main.js` sends the pass with the message.
- **Config:**
  - both keys are optional outside production and required by the production web server, while
    the shared config loads without them;
  - `.env.example` lists them;
  - the SSM, task-definition and IAM wiring are checked by the `config-drift-reviewer` agent.
- **Real browser**, headless Chrome with Cloudflare's official test keys (site keys that always
  pass or always block, with the matching secrets):
  - at 1280, 390 and 320px the box fits and nothing scrolls sideways;
  - a message goes through with a passing key;
  - it is refused with a blocking key, and the typed message stays;
  - the note shows with JavaScript off.
- **BDD:** `GET /api/contact/captcha` answers `{"siteKey":null}`, since the check is off in CI; the
  existing contact scenarios are unchanged.

## Not doing

- The footer signup and My Story. Add them later if bots move there.
- Managing the widget in Terraform. One widget made by hand is simpler than adding the Cloudflare
  provider and an API token to the Infra workflow.
- Marking kept-but-unchecked messages in the admin. They are logged.
- Checking the pass's hostname or action. Our secret only accepts passes from our own widget.
