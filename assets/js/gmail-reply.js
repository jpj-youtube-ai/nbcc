// Pure builder for a Gmail web-compose deep link that pre-fills a reply to a contact enquiry
// (2026-07-10 contact-inbox spec). No DOM, no network — unit-tested in test/unit/gmail-reply.test.js.
// Opening this URL in a new tab lands in whichever Gmail account the staff member is signed into
// (e.g. info@nbcc.scot). We cannot detect the actual send; the caller marks the enquiry Replied.

export function formatReceived(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  // e.g. "10 July 2026, 15:32" — human, unambiguous, local time.
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildGmailReplyUrl(enquiry) {
  const name = [enquiry.first_name, enquiry.last_name].filter(Boolean).join(" ").trim();
  const received = formatReceived(enquiry.created_at);
  const subject = "Re: your message to NBCC";
  const body =
    "\n\n\n----- Original message -----\n" +
    "Received: " + received + "\n" +
    "From: " + name + " <" + enquiry.email + ">\n\n" +
    (enquiry.message || "");
  return (
    "https://mail.google.com/mail/?view=cm&fs=1" +
    "&to=" + encodeURIComponent(enquiry.email) +
    "&su=" + encodeURIComponent(subject) +
    "&body=" + encodeURIComponent(body)
  );
}
