/* eslint-disable camelcase */

// The email send audit log. One row per send ATTEMPT from src/clients/email.ts (metadata only —
// never the body: bodies carry one-time links and 2FA codes that must not be stored), enriched
// afterwards by SES delivery events (delivered / bounced / complained) via the SES webhook.
// Additive only (expand-contract, golden rule 2). History starts at deploy: nothing recorded
// per-send existed before this table.

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable("email_log", {
    id: "id",
    // Which send this was — the kind strings src/clients/email.ts logs (donation, receipt,
    // loginCode, newsletter, thankYou, ballConfirmation, …). TEXT, not an enum: adding a kind
    // must never need a migration.
    kind: { type: "text", notNull: true },
    // Recipient, lowercased (delivery events compare lowercased).
    recipient: { type: "text", notNull: true },
    // The person's name where the send knew one; null otherwise.
    recipient_name: { type: "text" },
    subject: { type: "text", notNull: true },
    // What OUR send attempt did: 'sent' (accepted by the provider — or stubbed outside
    // production) or 'failed' (the attempt threw; error carries the reason, truncated).
    status: { type: "text", notNull: true },
    error: { type: "text" },
    // What the MAILBOX side reported afterwards, via SES -> SNS -> the webhook:
    // 'delivered' | 'bounced' | 'complained'; null until (unless) an event arrives.
    delivery_status: { type: "text" },
    delivery_at: { type: "timestamptz" },
    delivery_detail: { type: "text" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // The page reads newest-first; the webhook correlates by recipient + recency; filters hit
  // kind/status; pruning scans created_at.
  pgm.createIndex("email_log", [{ name: "created_at", sort: "DESC" }]);
  pgm.createIndex("email_log", ["recipient", { name: "created_at", sort: "DESC" }]);
  pgm.createIndex("email_log", ["kind"]);
  pgm.createIndex("email_log", ["status"]);
};

exports.down = (pgm) => {
  pgm.dropTable("email_log");
};
