import { eventPageUrl, fundraiserPageUrl } from "./send";
import type { FundraiserRecord } from "./model";

// Event pages: the full address of a page, whichever kind it is: nbcc.scot/event/<short name> for an
// event, nbcc.scot/fundraise/<slug> for a fundraiser raising money (pagePath in ./model.ts is the same
// path). Kept apart from ./send.ts so everything that already builds a fundraiser's address there is
// unchanged; an event's is only ever asked for an event.

export function pageUrlFor(f: Pick<FundraiserRecord, "path" | "slug">): string {
  return f.path === "event" ? eventPageUrl(f.slug) : fundraiserPageUrl(f.slug);
}
