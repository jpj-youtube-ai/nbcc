// A link we would be happy to put in front of a donor: a web address, an email address or a phone
// number. Anything else (an empty box, a bare "nbcc.scot/fill" with no https://, a javascript: address)
// is not sendable.
//
// One rule, two users. The checks before sending (./preflight.ts) use it to say "this button goes
// nowhere"; the paper look blocks (./paper-blocks.ts) use it to decide whether to write a link at all,
// so a bad address never reaches an inbox even if the warning is overridden.
export function looksSendable(href: string): boolean {
  const url = href.trim();
  if (!url) return false;
  return /^(https?:\/\/|mailto:|tel:)/i.test(url);
}
