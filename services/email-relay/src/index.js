// NBCC email relay: a Cloudflare Worker that bridges the app's custom email payloads
// (src/clients/email.ts) to the Resend API. The app POSTs its OWN JSON shape (auth in the
// URL) to EMAIL_SEND_URL; this maps each shape to a {from, to, subject, html, text} Resend
// send.
//
// TASK-209: every transactional email now shares ONE branded shell (modelled on the admin
// thank-you letter email, src/thank-you/letter.ts: maroon page, cream panel, NBCC letterhead
// and the maroon contact/legal footer bar) and each kind carries its OWN correct subject.
// The app tags each send with a `kind` string so the relay routes unambiguously. Before this,
// the field-sniffing heuristics collided: the 2FA login code fell through to the donation
// default and got "Thank you for your donation to NBCC", and the portal / admin-invite /
// admin-reset links were indistinguishable. The heuristics are kept below ONLY as a
// deploy-skew fallback for a payload that arrives WITHOUT a `kind`.
//
// Auth: the app carries the shared secret in the URL query (?key=...); it sends no auth
// header. We compare that to RELAY_SECRET. The Resend key (RESEND_API_KEY) and the verified
// sender (MAIL_FROM) live ONLY here as Worker secrets, never in the app.
//
// Secrets/vars (wrangler secret put / [vars]):
//   RESEND_API_KEY  - Resend API key (re_...)                    [secret]
//   RELAY_SECRET    - shared token also in EMAIL_SEND_URL ?key=  [secret]
//   MAIL_FROM       - e.g. "NBCC <noreply@nbcc.scot>"            [var]

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

const gbp = (pence, currency) => {
  const n = (Number(pence) || 0) / 100;
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP" }).format(n);
  } catch {
    return `£${n.toFixed(2)}`;
  }
};

// --- TASK-209 branded shell -------------------------------------------------------------
// Brand palette + font stacks: hex/stack mirrors of the site tokens, inlined because email
// has no stylesheet. Kept identical to src/thank-you/letter.ts so the whole NBCC email family
// (the thank-you letter + every transactional email) reads as one design.
const MAROON = "#800000";
const CRIMSON = "#C02238";
const CREAM = "#F8F5EE";
const SLATE = "#333333";
const SLATE_SOFT = "#6F6A66";
const TAN_SOFT = "#F3E4DD";
const CREAM_82 = "rgba(248,245,238,.82)";
const HEAD = "'Playfair Display', Georgia, 'Times New Roman', serif";
const BODY_FONT = "'Poppins', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const LOGO_URL = "https://nbcc.scot/assets/img/nbcc-logo.png";

// The charity-registration sentence, mirrored verbatim from the thank-you letter email so the
// whole email family agrees. Shown in the maroon footer ONLY for relay-built kinds; the
// app-built kinds (donation / receipt / refund) already carry it in their own body, so their
// footer omits it (contacts only) to avoid a duplicate.
const CHARITY_REGISTRATION =
  "Night Before Christmas Campaign, known as NBCC, is a Scottish Charitable Incorporated Organisation. Scottish Charity Number SC047995, regulated by OSCR.";
// Plain-text footer contacts (mirrors the maroon bar), appended to every kind's text part so
// every email carries the phone number and giving@ address.
const TEXT_CONTACTS = "01292 811 015 · giving@nbcc.scot · nbcc.scot";

// The APPROVED branded shell. A full, self-contained HTML document (mail clients need the
// color-scheme meta so dark mode does not invert the maroon/cream palette). `bodyHtml` drops
// into the cream panel; `includeRegistration` adds the legal sentence under the contact line
// in the maroon footer (true for relay-built kinds, false for app-built ones).
const shell = (bodyHtml, includeRegistration) => `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- color-scheme: light keeps the maroon/cream palette in dark-mode mail clients (no auto-invert). -->
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<style>:root { color-scheme: light; supported-color-schemes: light; }</style>
</head>
<body style="margin:0;background:${MAROON};padding:24px 0;font-family:${BODY_FONT}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:660px;margin:0 auto;background:${CREAM}">
    <tr><td style="padding:30px 40px 16px;text-align:center;border-bottom:1px solid ${TAN_SOFT}">
      <img src="${LOGO_URL}" alt="Night Before Christmas Campaign" width="150" style="display:inline-block;height:auto;max-width:150px" />
      <div style="font-family:${BODY_FONT};font-weight:800;text-transform:uppercase;letter-spacing:.18em;color:${MAROON};font-size:13px;margin-top:2px">Here all year</div>
    </td></tr>
    <tr><td style="padding:24px 40px 28px;color:${SLATE};font-family:${BODY_FONT};font-size:14px;line-height:1.6">${bodyHtml}</td></tr>
    <tr><td style="background:${MAROON};color:${CREAM};padding:20px 40px;font-family:${BODY_FONT};font-size:14px;text-align:center">
      <div style="font-weight:700"><a href="tel:+441292811015" style="color:${CREAM};text-decoration:none">01292 811 015</a> &nbsp;·&nbsp; <a href="mailto:giving@nbcc.scot" style="color:${CREAM};text-decoration:underline">giving@nbcc.scot</a> &nbsp;·&nbsp; <a href="https://nbcc.scot" style="color:${CREAM};text-decoration:underline">nbcc.scot</a></div>${includeRegistration ? `
      <div style="color:${CREAM_82};font-size:11px;margin-top:8px">${CHARITY_REGISTRATION}</div>` : ""}
    </td></tr>
  </table>
</body>
</html>`;

// Body-fragment helpers for the relay-built kinds (crimson serif heading, slate body copy, a
// crimson pill CTA button, a maroon code callout). Colours match the thank-you letter email.
const heading = (t) => `<h1 style="color:${CRIMSON};font-family:${HEAD};font-size:24px;font-weight:800;margin:0 0 12px;letter-spacing:-.01em">${t}</h1>`;
const bodyP = (html) => `<p style="color:${SLATE};font-family:${BODY_FONT};font-size:14px;line-height:1.6;margin:0 0 12px">${html}</p>`;
const note = (html) => `<p style="color:${SLATE_SOFT};font-family:${BODY_FONT};font-size:13px;line-height:1.55;margin:14px 0 0">${html}</p>`;
const button = (href, label) =>
  `<div style="text-align:center;margin:22px 0"><a href="${esc(href)}" style="display:inline-block;background:${CRIMSON};color:${CREAM};text-decoration:none;font-family:${BODY_FONT};font-weight:700;font-size:15px;padding:12px 26px;border-radius:999px">${esc(label)}</a></div>`;
const codeBox = (code) =>
  `<div style="text-align:center;margin:22px 0"><div style="display:inline-block;background:${TAN_SOFT};border-radius:10px;padding:14px 28px;font-family:${HEAD};font-size:32px;font-weight:800;letter-spacing:8px;color:${MAROON}">${esc(code)}</div></div>`;

// Build a RELAY-built email: wrap the body fragment in the shell (footer WITH registration)
// and append the contacts + registration to the text part.
const relayBuilt = (to, subject, bodyHtml, bodyText) => ({
  to,
  subject,
  html: shell(bodyHtml, true),
  text: `${bodyText}\n\n${TEXT_CONTACTS}\n${CHARITY_REGISTRATION}`,
});
// Build an APP-body email: wrap the app html in the shell (footer contacts only, no
// registration, since the app body already carries it) and append only the contacts to the
// app text (which already ends with the registration line).
const appBody = (to, subject, html, text) => ({
  to,
  subject,
  html: shell(html || "", false),
  text: `${text ?? ""}\n${TEXT_CONTACTS}`,
});

// Wrap a rendered HTML fragment in a minimal document; return {subject, html, text}. Legacy
// fallback wrapper: only reached by a no-kind payload during a deploy skew, and by the contact
// route. Kept intentionally plain (the branded shell above is for kind-routed mail).
const page = (subject, bodyHtml, bodyText) => ({
  subject,
  html: `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#1a1a1a;line-height:1.5">${bodyHtml}<hr style="border:none;border-top:1px solid #eee;margin:24px 0"><p style="font-size:12px;color:#888">Night Before Christmas Campaign · nbcc.scot</p></body></html>`,
  text: `${bodyText}\n\nNight Before Christmas Campaign · nbcc.scot`,
});

// Map an app payload to a Resend send. Returns {subject, html, text, to, ...}.
// TASK-209: route by the explicit `kind` first (branded shell + the CORRECT subject per kind),
// then fall back to the legacy field heuristics for a payload that arrives WITHOUT a `kind`
// (a deploy-skew net, so an app and Worker deployed at different times still deliver mail).
export function buildEmail(p) {
  const to = p.email;

  // Newsletter (sendNewsletter): the app ships its OWN subject + fully rendered, branded html,
  // plus a per-message from/reply-to (newsletter@nbcc.scot) so the send is repliable. Flagged by
  // `newsletter` and left exactly as-is. from/replyTo are honoured by sendViaResend.
  if (p.newsletter && (p.html || p.text)) {
    return { to, subject: p.subject, html: p.html, text: p.text, from: p.from, replyTo: p.replyTo };
  }

  // Thank-you letter (sendThankYou): like the newsletter, the app ships its OWN subject + fully
  // rendered, branded html + a repliable from/reply-to (and optional cc). Flagged by `thankYou`
  // and left exactly as-is (it is the design the transactional shell above now mirrors).
  if (p.thankYou && (p.html || p.text)) {
    return { to, cc: p.cc, subject: p.subject, html: p.html, text: p.text, from: p.from, replyTo: p.replyTo };
  }

  // --- Explicit `kind` routing: branded shell + the CORRECT subject per kind ---------------

  // App-built bodies (html + text already rendered by the app, ending with the charity line):
  // wrap in the shell with a contacts-only footer and keep the app content verbatim.
  if (p.kind === "donation") return appBody(to, "Thank you for your donation to NBCC", p.html, p.text);
  if (p.kind === "receipt") return appBody(to, "Your NBCC donation receipt", p.html, p.text);
  if (p.kind === "refund") return appBody(to, "Your NBCC refund confirmation", p.html, p.text);

  // Relay-built bodies: a short branded body (greeting + the code or a link button + a note),
  // footer carrying the contacts THEN the charity registration.
  if (p.kind === "loginCode") {
    return relayBuilt(
      to,
      "Your NBCC admin sign-in code",
      `${heading("Your sign-in code")}${bodyP(`Hello ${esc(p.fullName)},`)}${bodyP("Use this code to finish signing in to your NBCC admin account:")}${codeBox(p.code)}${note("This code expires in 10 minutes. If you did not request it, you can ignore this email.")}`,
      `Hello ${p.fullName},\n\nYour NBCC admin sign-in code is ${p.code}. This code expires in 10 minutes.\n\nIf you did not request this, you can ignore this email.`,
    );
  }
  if (p.kind === "adminInvite") {
    return relayBuilt(
      to,
      "Your NBCC admin account invitation",
      `${heading("You have been invited")}${bodyP(`Hello ${esc(p.fullName)},`)}${bodyP("You have been invited to join the NBCC admin team. Use the button below to set up your account. This link is single use and expires soon.")}${button(p.link, "Accept your invitation")}${note("If you were not expecting this, you can ignore this email.")}`,
      `Hello ${p.fullName},\n\nYou have been invited to join the NBCC admin team. Set up your account using this single-use link (it expires soon):\n${p.link}\n\nIf you were not expecting this, you can ignore this email.`,
    );
  }
  if (p.kind === "adminReset") {
    return relayBuilt(
      to,
      "Reset your NBCC admin password",
      `${heading("Reset your password")}${bodyP(`Hello ${esc(p.fullName)},`)}${bodyP("We received a request to reset your NBCC admin password. Use the button below to choose a new one. This link is single use and expires soon.")}${button(p.link, "Reset my password")}${note("If you did not request this, you can ignore this email and your password stays unchanged.")}`,
      `Hello ${p.fullName},\n\nWe received a request to reset your NBCC admin password. Choose a new one using this single-use link (it expires soon):\n${p.link}\n\nIf you did not request this, ignore this email and your password stays unchanged.`,
    );
  }
  if (p.kind === "portal") {
    return relayBuilt(
      to,
      "Your NBCC donor portal link",
      `${heading("Your donor portal link")}${bodyP(`Hello ${esc(p.fullName)},`)}${bodyP("Use the button below to open your NBCC donor portal. This is a one-time link that expires soon.")}${button(p.link, "Open my portal")}${note("If you did not request this, you can ignore this email.")}`,
      `Hello ${p.fullName},\n\nOpen your NBCC donor portal using this one-time link (it expires soon):\n${p.link}\n\nIf you did not request this, you can ignore this email.`,
    );
  }
  if (p.kind === "declaration") {
    return relayBuilt(
      to,
      "Add Gift Aid to your NBCC donation",
      `${heading("Add Gift Aid to your donation")}${bodyP(`Thank you for your donation of <strong>${esc(gbp(p.amountPence, p.currency))}</strong>.`)}${bodyP("You can add Gift Aid, worth an extra 25% to us at no cost to you, using the secure link below.")}${button(p.declarationLink, "Add Gift Aid to my donation")}${note(`Or use this short link: ${esc(p.shortLink)}`)}`,
      `Thank you for your donation of ${gbp(p.amountPence, p.currency)}.\n\nAdd Gift Aid (worth 25% more to us at no cost to you): ${p.declarationLink}\nShort link: ${p.shortLink}`,
    );
  }
  if (p.kind === "lapsedDonor") {
    return relayBuilt(
      to,
      "Your NBCC monthly donation has stopped",
      `${heading("Your monthly donation has stopped")}${bodyP(`Hello ${esc(p.fullName)},`)}${bodyP("We were unable to collect your recent monthly donation, so it has stopped. If you would like to continue supporting us, you can set it up again on our website.")}${button("https://nbcc.scot/donate", "Restart my monthly donation")}`,
      `Hello ${p.fullName},\n\nWe were unable to collect your recent monthly donation, so it has stopped. To continue supporting us, restart it here: https://nbcc.scot/donate`,
    );
  }
  if (p.kind === "lapsedAdmin") {
    return relayBuilt(
      to,
      "A monthly NBCC subscription has lapsed",
      `${heading("A monthly subscription has lapsed")}${bodyP("A monthly donation has lapsed (Stripe retries exhausted).")}${bodyP(`Donor: <strong>${esc(p.donorName)}</strong><br>Subscription: <code>${esc(p.subscriptionId)}</code>`)}`,
      `A monthly donation has lapsed (Stripe retries exhausted).\nDonor: ${p.donorName}\nSubscription: ${p.subscriptionId}`,
    );
  }

  // --- Legacy field heuristics: ONLY reached when `p.kind` is absent (deploy-skew net) ------
  // Mirrors the pre-TASK-209 behaviour so a no-kind payload from an older app still delivers.
  if (p.declarationLink) {
    return {
      to,
      ...page(
        "Add Gift Aid to your NBCC donation",
        `<p>Thank you for your donation of <strong>${esc(gbp(p.amountPence, p.currency))}</strong>.</p>
         <p>You can add Gift Aid, worth an extra 25% to us at no cost to you, using the secure link below:</p>
         <p><a href="${esc(p.declarationLink)}">Add Gift Aid to my donation</a></p>
         <p style="font-size:13px;color:#555">Or use this short link: ${esc(p.shortLink)}</p>`,
        `Thank you for your donation of ${gbp(p.amountPence, p.currency)}.\n\nAdd Gift Aid (worth 25% more at no cost to you): ${p.declarationLink}\nShort link: ${p.shortLink}`,
      ),
    };
  }
  if (p.refundedPence != null && (p.text || p.html)) {
    return { to, subject: "Your NBCC refund confirmation", html: p.html, text: p.text };
  }
  if (p.legalName && (p.text || p.html)) {
    return { to, subject: "Your NBCC donation receipt", html: p.html, text: p.text };
  }
  if (p.link && p.fullName) {
    return {
      to,
      ...page(
        "Your NBCC donor portal access link",
        `<p>Hello ${esc(p.fullName)},</p>
         <p>Use this one-time, expiring link to access your donor portal:</p>
         <p><a href="${esc(p.link)}">Access my portal</a></p>
         <p style="font-size:13px;color:#555">If you didn't request this, you can ignore this email.</p>`,
        `Hello ${p.fullName},\n\nAccess your donor portal (one-time, expiring link):\n${p.link}\n\nIf you didn't request this, ignore this email.`,
      ),
    };
  }
  if (p.subscriptionId && p.donorName) {
    return {
      to,
      ...page(
        "[NBCC] A monthly subscription has lapsed",
        `<p>A monthly donation has lapsed (Stripe retries exhausted).</p>
         <p>Donor: <strong>${esc(p.donorName)}</strong><br>Subscription: <code>${esc(p.subscriptionId)}</code></p>`,
        `A monthly donation has lapsed (Stripe retries exhausted).\nDonor: ${p.donorName}\nSubscription: ${p.subscriptionId}`,
      ),
    };
  }
  if (p.subscriptionId && p.fullName) {
    return {
      to,
      ...page(
        "Your NBCC monthly donation has stopped",
        `<p>Hello ${esc(p.fullName)},</p>
         <p>We were unable to collect your recent monthly donation, so it has stopped. If you'd like to continue supporting us, you can set it up again on our website.</p>
         <p><a href="https://nbcc.scot/donate">Restart my monthly donation</a></p>`,
        `Hello ${p.fullName},\n\nWe were unable to collect your recent monthly donation, so it has stopped. To continue supporting us, restart it here: https://nbcc.scot/donate`,
      ),
    };
  }
  // Default: donation confirmation (has text/html).
  if (p.text || p.html) {
    return { to, subject: "Thank you for your donation to NBCC", html: p.html, text: p.text };
  }
  return null; // unrecognised
}

// Contact enquiry (src/clients/contact.ts) -> an email to the NBCC inbox (CONTACT_TO),
// reply-to the enquirer. Distinct payload {firstName,lastName,email,message}, so it has
// its own route (/contact) rather than sharing the transactional discriminator.
function buildContact(p, env) {
  const name = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || "Website visitor";
  return {
    to: env.CONTACT_TO,
    replyTo: p.email,
    ...page(
      `Website enquiry from ${name}`,
      `<p><strong>${esc(name)}</strong> &lt;${esc(p.email)}&gt; wrote:</p>
       <blockquote style="border-left:3px solid #ddd;padding-left:12px;color:#333;white-space:pre-wrap">${esc(p.message)}</blockquote>`,
      `${name} <${p.email}> wrote:\n\n${p.message}`,
    ),
  };
}

async function sendViaResend(env, msg) {
  const body = {
    from: msg.from || env.MAIL_FROM,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  };
  if (msg.replyTo) body.reply_to = msg.replyTo;
  if (msg.cc) body.cc = msg.cc; // optional CC (TASK-168)
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return new Response(`Resend error ${res.status}: ${detail}`, { status: 502 });
  }
  return new Response("sent", { status: 200 });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const url = new URL(request.url);
    // Auth: shared secret in the URL query (?key=...), matching EMAIL_SEND_URL / CONTACT_FORWARD_URL.
    if (!env.RELAY_SECRET || (url.searchParams.get("key") || "") !== env.RELAY_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    // /contact -> contact-form enquiry; anything else (/send) -> transactional email.
    if (url.pathname.endsWith("/contact")) {
      if (!payload || !payload.email || !payload.message) {
        return new Response("Missing enquiry fields", { status: 422 });
      }
      if (!env.CONTACT_TO) return new Response("CONTACT_TO not configured", { status: 500 });
      return sendViaResend(env, buildContact(payload, env));
    }

    if (!payload || !payload.email) return new Response("Missing recipient", { status: 422 });
    const built = buildEmail(payload);
    if (!built) return new Response("Unrecognised payload", { status: 422 });
    return sendViaResend(env, built);
  },
};
