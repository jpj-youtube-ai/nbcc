import { config } from "../config";
import { listOutreachForTodo, listVolunteers } from "../db/outreach";
import { sendOutreachInvitation } from "../clients/email";
import { escapeHtml } from "./invitation-email";
import { whatIsNeeded, sortTodos } from "./todo";
import { runDigestPass, type Digest, type DigestPassResult } from "./digest";

// TASK-415: the wiring for the Monday note.
//
// Same split as every other pass here: everything that decides anything is pure and lives in
// digest.ts; this connects it to the pool, the mail client and the clock, and rides the daily task
// that already exists.

/**
 * Plainer than anything we send a business, on purpose. This is an internal nudge to somebody who
 * already knows what it is about, and dressing it up would make it look like something to read
 * later rather than a list to act on now.
 */
function buildDigestEmail(digest: Digest, adminUrl: string): { html: string; text: string } {
  const items = digest.lines.map((l) => `<li style="margin:0 0 6px;">${escapeHtml(l)}</li>`).join("");
  return {
    text: `Morning ${digest.name},

${digest.lines.map((l) => `  - ${l}`).join("\n")}

They are all on the Contact businesses page: ${adminUrl}

If none of it is for you this week, it will keep. Nothing here is urgent enough
to spoil a Monday.`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${escapeHtml(digest.subject)}</title></head>
<body style="margin:0;padding:24px;background:#F8F5EE;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#333333;font-size:16px;line-height:1.7;">
  <p style="margin:0 0 14px;">Morning ${escapeHtml(digest.name)},</p>
  <ul style="margin:0 0 18px;padding-left:20px;">${items}</ul>
  <p style="margin:0 0 18px;">
    <a href="${escapeHtml(adminUrl)}" style="color:#800000;font-weight:600;">Open Contact businesses</a>
  </p>
  <p style="margin:0;color:#6B6459;font-size:14px;">
    If none of it is for you this week, it will keep. Nothing here is urgent enough to spoil a Monday.
  </p>
</body></html>`,
  };
}

export async function runWeeklyDigest(): Promise<DigestPassResult> {
  const now = new Date();
  const base = config.PORTAL_BASE_URL.replace(/\/+$/, "");
  return runDigestPass({
    now,
    listTodos: async () => {
      const rows = await listOutreachForTodo();
      return sortTodos(
        rows
          .map((r) => whatIsNeeded(r, now))
          .filter((t): t is NonNullable<typeof t> => t !== null),
      );
    },
    listVolunteers,
    send: async (digest) => {
      const mail = buildDigestEmail(digest, `${base}/admin`);
      await sendOutreachInvitation(digest.name, {
        email: digest.email,
        from: config.GIVING_FROM_EMAIL,
        replyTo: config.GIVING_FROM_EMAIL,
        subject: digest.subject,
        html: mail.html,
        text: mail.text,
      });
    },
  });
}
