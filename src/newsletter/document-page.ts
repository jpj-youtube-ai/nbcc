// Hosted newsletter documents (replaces email attachments — see
// docs/superpowers/specs/2026-07-22-newsletter-hosted-documents-design.md). A newsletter button
// links to `/newsletter/document/<uuid>`; this builds that page: the document previewed inline
// where the browser can show it (PDF, images), plus explicit print/open and download actions —
// the same "a link, not an attachment" pattern as the thank-you letter page, which keeps
// deliverability clean and sidesteps the relay's lack of attachment forwarding entirely.
// Pure and DB-free (the route loads the row and passes the metadata in), so it is unit-tested
// directly (test/unit/newsletter-document-page.test.ts).

export interface DocumentPageData {
  id: string; // the attachment uuid — the capability that addresses the file
  filename: string;
  mime: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The shared page shell: maroon toolbar with the actions, cream ground, centred content column.
// Mirrors the thank-you letter page's use of the site stylesheet for fonts + brand tokens.
function shell(title: string, toolbar: string, body: string): string {
  return `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${title} | NBCC</title>
  <link rel="stylesheet" href="/assets/css/styles.css" />
  <style>
    *{box-sizing:border-box}
    html,body{margin:0;min-height:100vh;background:var(--cream);-webkit-text-size-adjust:100%;text-size-adjust:100%}
    .toolbar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:10px 12px;align-items:center;padding:12px 16px;background:var(--maroon);color:var(--cream);font-family:var(--font-body)}
    .toolbar .doc-name{flex:1 1 200px;min-width:0;font-weight:700;font-size:.95rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .toolbar .doc-org{font-weight:800;text-transform:uppercase;letter-spacing:.16em;font-size:.72rem;opacity:.85;margin-right:4px}
    .toolbar a.act{font-family:var(--font-body);font-weight:600;font-size:.9rem;text-decoration:none;border-radius:var(--radius-pill);padding:8px 20px;background:var(--cream);color:var(--maroon)}
    .toolbar a.act.secondary{background:transparent;color:var(--cream);border:1.4px solid var(--cream)}
    .toolbar a.act:focus-visible{outline:2px solid var(--cream);outline-offset:2px}
    main{display:flex;flex-direction:column;align-items:center;padding:20px 16px 48px}
    .frame{width:min(920px,100%);background:var(--maroon);padding:10px;box-shadow:0 10px 40px rgba(0,0,0,.18)}
    .frame iframe{display:block;width:100%;height:min(1100px,78vh);border:0;background:#fff}
    .frame img{display:block;width:100%;height:auto;background:#fff}
    .no-preview{width:min(560px,100%);background:#fff;border:1px solid var(--tan-soft);border-radius:12px;padding:28px 24px;text-align:center;font-family:var(--font-body);color:var(--slate)}
    .no-preview h2{font-family:var(--font-head);color:var(--maroon);margin:0 0 8px;font-size:1.2rem}
    .foot{margin-top:18px;font-family:var(--font-body);font-size:.82rem;color:var(--slate-soft);text-align:center}
    @media print{.toolbar,.foot{display:none}.frame{box-shadow:none;padding:0}}
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="doc-org">NBCC</span>
    ${toolbar}
  </div>
  <main>
    ${body}
    <p class="foot">Night Before Christmas Campaign &middot; nbcc.scot</p>
  </main>
</body>
</html>`;
}

// Render the hosted viewer page for one uploaded document.
export function buildDocumentPage(d: DocumentPageData): string {
  const name = escapeHtml(d.filename);
  const fileUrl = `/newsletter/document/${d.id}/file`;
  const downloadUrl = `${fileUrl}?download=1`;

  // "Open / print" opens the raw file in a new tab: for PDFs the browser's own viewer prints far
  // more reliably than printing an embedding page, and for images the full-size view prints clean.
  const toolbar = `<span class="doc-name">${name}</span>
    <a class="act secondary" href="${fileUrl}" target="_blank" rel="noopener">Open full size / print</a>
    <a class="act" href="${downloadUrl}" download>Download</a>`;

  let preview: string;
  if (d.mime === "application/pdf") {
    preview = `<div class="frame"><iframe src="${fileUrl}" title="${name}"></iframe></div>`;
  } else if (d.mime.startsWith("image/")) {
    preview = `<div class="frame"><img src="${fileUrl}" alt="${name}" /></div>`;
  } else {
    // Word/Excel/CSV/plain text: browsers won't render these inline — offer the actions instead of
    // an empty grey box.
    preview = `<div class="no-preview"><h2>Ready to download</h2>
      <p>This file type can't be previewed in the browser. Use <b>Download</b> above to save
      <b>${name}</b> to your device.</p></div>`;
  }

  return shell(name, toolbar, preview);
}

// The branded "not found" page: an unknown or malformed document id, or a draft's document that was
// deleted before sending. Deliberately gives nothing away about which of those it was.
export function buildDocumentNotFoundPage(): string {
  const toolbar = `<span class="doc-name">Document</span>`;
  const body = `<div class="no-preview"><h2>This document could not be found</h2>
    <p>The link may be incomplete — try copying the whole link from your email. If you keep
    landing here, reply to the email and we'll send the document directly.</p></div>`;
  return shell("Document not found", toolbar, body);
}
