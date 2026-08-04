import type { NewsletterDoc } from "./blocks";

// TASK-277 (letter P): the checks that run before a newsletter goes out.
//
// A newsletter is the one action in this admin that cannot be undone — once it is in several hundred
// inboxes, a dead button or a missing image description is permanent. These are the mistakes that are
// obvious in hindsight and invisible while writing, so they are surfaced at the moment of sending,
// where someone can still act on them.
//
// Pure: takes the document and a little context, returns findings. No DB, no network, so every rule
// is unit-tested and the same answer backs the API and (later) any other caller.
//
// Two severities, and the distinction matters:
//   'block'  — almost certainly a mistake nobody wants sent (a button that goes nowhere). The UI
//              requires an explicit override rather than refusing outright: it is the charity's
//              newsletter, and a tool that flatly blocks a send invites people to work around it.
//   'warn'   — worth a look, legitimately ignorable (no test send yet, an image without alt text).

export type PreflightLevel = "block" | "warn";

export interface PreflightFinding {
  level: PreflightLevel;
  message: string;
}

export interface PreflightContext {
  // Whether a test copy of THIS draft has been sent to a person yet.
  testSent: boolean;
  subject: string;
}

function str(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  return typeof value === "string" ? value : "";
}

// A link we would be happy to put in front of a donor.
function looksSendable(href: string): boolean {
  const url = href.trim();
  if (!url) return false;
  return /^(https?:\/\/|mailto:|tel:)/i.test(url);
}

export function preflightNewsletter(doc: NewsletterDoc, ctx: PreflightContext): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  const blocks = doc.blocks ?? [];

  if (blocks.length === 0) {
    findings.push({ level: "block", message: "This newsletter has no content yet." });
  }

  if (!ctx.subject.trim()) {
    findings.push({ level: "block", message: "The subject line is empty — that is the first thing people see." });
  }

  // A subject that still contains the raw marker means the merge was mistyped: {{firstname}} and
  // {{ firstName }} are NOT substituted, and would reach every reader as literal text.
  const unknownTags = new Set<string>();
  const collectTags = (text: string) => {
    for (const match of text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
      if (match[1] !== "firstName") unknownTags.add(match[0]);
    }
  };
  collectTags(ctx.subject);

  let imagesWithoutAlt = 0;
  let deadLinks = 0;

  for (const block of blocks) {
    const data = (block.data ?? {}) as Record<string, unknown>;
    for (const key of ["text", "lead", "heading", "title", "body", "label"]) collectTags(str(data, key));

    // A button whose href is empty or not a real link renders as nothing (or as a dead end). The
    // renderer silently drops an empty one, so it never looks wrong in the preview either.
    if (block.type === "button" || block.type === "donationCta") {
      const href = str(data, "href");
      if (href !== "" && !looksSendable(href)) deadLinks++;
      if (block.type === "button" && href === "") deadLinks++;
    }

    // Alt text is what a screen reader announces and what shows when images are blocked — which is the
    // DEFAULT in many inboxes, so an image with no alt is simply missing for those readers.
    if (block.type === "image" && !str(data, "alt").trim()) imagesWithoutAlt++;
  }

  if (deadLinks > 0) {
    findings.push({
      level: "block",
      message:
        deadLinks === 1
          ? "A button has no working link — it will go nowhere."
          : `${deadLinks} buttons have no working link — they will go nowhere.`,
    });
  }

  for (const tag of unknownTags) {
    findings.push({
      level: "block",
      message: `${tag} is not a merge tag we understand — it will be sent exactly as written. Did you mean {{firstName}}?`,
    });
  }

  if (imagesWithoutAlt > 0) {
    findings.push({
      level: "warn",
      message:
        imagesWithoutAlt === 1
          ? "An image has no description. Many inboxes block images by default, so that reader sees nothing there."
          : `${imagesWithoutAlt} images have no description. Many inboxes block images by default, so those readers see nothing there.`,
    });
  }

  if (!ctx.testSent) {
    findings.push({
      level: "warn",
      message: "You haven't sent yourself a test copy of this newsletter yet.",
    });
  }

  return findings;
}

// Convenience for the caller: is anything here serious enough to want a deliberate override?
export function hasBlockingFindings(findings: PreflightFinding[]): boolean {
  return findings.some((f) => f.level === "block");
}
