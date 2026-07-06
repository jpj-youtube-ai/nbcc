// NBCC email relay — a Cloudflare Worker that bridges the app's custom email payloads
// (src/clients/email.ts) to the Resend API. The app POSTs its OWN JSON shape (no
// subject/from/type, auth in the URL) to EMAIL_SEND_URL; this maps each shape to a
// {from, to, subject, html, text} Resend send.
//
// Auth: the app carries the shared secret in the URL query (?key=…) — it sends no auth
// header. We compare that to RELAY_SECRET. The Resend key (RESEND_API_KEY) and the
// verified sender (MAIL_FROM) live ONLY here as Worker secrets, never in the app.
//
// Secrets/vars (wrangler secret put / [vars]):
//   RESEND_API_KEY  — Resend API key (re_…)          [secret]
//   RELAY_SECRET    — shared token also in EMAIL_SEND_URL ?key=  [secret]
//   MAIL_FROM       — e.g. "NBCC <noreply@nbcc.scot>"           [var]

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

// Wrap a rendered HTML fragment in a minimal document; return {subject, html, text}.
const page = (subject, bodyHtml, bodyText) => ({
  subject,
  html: `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#1a1a1a;line-height:1.5">${bodyHtml}<hr style="border:none;border-top:1px solid #eee;margin:24px 0"><p style="font-size:12px;color:#888">Night Before Christmas Charity · nbcc.scot</p></body></html>`,
  text: `${bodyText}\n\n—\nNight Before Christmas Charity · nbcc.scot`,
});

// Map an app payload to a Resend send. Returns {from-independent} {subject, html, text, to}.
function buildEmail(p) {
  const to = p.email;

  // Types that already ship rendered text + html — just wrap with a subject.
  if (p.declarationLink) {
    return {
      to,
      ...page(
        "Add Gift Aid to your NBCC donation",
        `<p>Thank you for your donation of <strong>${esc(gbp(p.amountPence, p.currency))}</strong>.</p>
         <p>You can add Gift Aid — worth an extra 25% to us at no cost to you — using the secure link below:</p>
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
    // admin notice
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
    // donor notice
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
  // Default: donation confirmation (has text/html + fullName + amountPence).
  if (p.text || p.html) {
    return { to, subject: "Thank you for your donation to NBCC", html: p.html, text: p.text };
  }
  return null; // unrecognised
}

// Contact enquiry (src/clients/contact.ts) → an email to the NBCC inbox (CONTACT_TO),
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
    from: env.MAIL_FROM,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  };
  if (msg.replyTo) body.reply_to = msg.replyTo;
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
    // Auth: shared secret in the URL query (?key=…), matching EMAIL_SEND_URL / CONTACT_FORWARD_URL.
    if (!env.RELAY_SECRET || (url.searchParams.get("key") || "") !== env.RELAY_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response("Bad JSON", { status: 400 });
    }

    // /contact → contact-form enquiry; anything else (/send) → transactional email.
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
