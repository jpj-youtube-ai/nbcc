import { pool } from "./pool";
import { WORKSHOP_SIZES, type WorkshopSize } from "../red-bag/workshop";

// Fill a Red Bag: companies' own Workshops, in red_bag_workshops (migrations/1791200000390), and the
// totals the Workshop's shelves show. A company's link is /fill/<slug>; gifts given through it carry
// donations.red_bag_workshop_id (written by the Stripe webhook after the donation is saved).
//
// The public page's two reads (a workshop by its link, and the totals) are cached for a minute and
// never throw: on any trouble the last good answer stands, or nothing (the page then draws the
// everyday Workshop at its opening stage, with no count on the sign).

/** The shelves count Fill a Red Bag gifts from here (Jaimie, 6 November 2026): 1 November 2026, UK. */
export const WORKSHOP_SEASON_FROM = "2026-11-01T00:00:00Z";

/** Paths under /fill that are already pages, so no company can take them. */
export const RESERVED_WORKSHOP_SLUGS: readonly string[] = ["thank-you", "thanks", "preview", "admin", "bag", "api"];

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const WORKSHOP_SLUG_MAX = 60;
export const WORKSHOP_NAME_MAX = 80;

/** A link from a company's name: "GE Aviation" -> "ge-aviation". "" if nothing usable is left. */
export function slugFromName(name: string): string {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, WORKSHOP_SLUG_MAX)
    .replace(/-+$/g, "");
}

/** Is this a link a company may have: the right shape, and not one of the page's own? */
export function slugAllowed(slug: string): boolean {
  return typeof slug === "string" && slug.length <= WORKSHOP_SLUG_MAX && SLUG_RE.test(slug) && !RESERVED_WORKSHOP_SLUGS.includes(slug);
}

export function sizeOf(value: unknown): WorkshopSize | null {
  return (WORKSHOP_SIZES as readonly string[]).includes(String(value)) ? (value as WorkshopSize) : null;
}

export interface RedBagWorkshop {
  id: number;
  slug: string;
  name: string;
  size: WorkshopSize;
  createdAt: string;
  archivedAt: string | null;
}

interface Row {
  id: number | string;
  slug: string;
  name: string;
  size: string;
  created_at: Date | string;
  archived_at: Date | string | null;
}

const iso = (d: Date | string | null): string | null => (d == null ? null : new Date(d).toISOString());
const toWorkshop = (r: Row): RedBagWorkshop => ({
  id: Number(r.id),
  slug: r.slug,
  name: r.name,
  size: sizeOf(r.size) ?? "medium",
  createdAt: iso(r.created_at) ?? "",
  archivedAt: iso(r.archived_at),
});
const COLUMNS = "id, slug, name, size, created_at, archived_at";

// ------------------------------------------------------------------------------------------------
// The admin's reads and writes
// ------------------------------------------------------------------------------------------------

export async function listRedBagWorkshops(): Promise<RedBagWorkshop[]> {
  const r = await pool.query<Row>(`SELECT ${COLUMNS} FROM red_bag_workshops ORDER BY archived_at IS NOT NULL, lower(name), id`);
  return r.rows.map(toWorkshop);
}

export type CreateResult = { ok: true; workshop: RedBagWorkshop } | { ok: false; reason: "name" | "slug" | "size" | "taken" };

/** A new company Workshop. The link is taken for ever, so a taken one (even archived) is refused. */
export async function createRedBagWorkshop(input: { name: string; slug?: string; size: string; by: string }): Promise<CreateResult> {
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > WORKSHOP_NAME_MAX) return { ok: false, reason: "name" };
  const slug = input.slug ? String(input.slug).trim().toLowerCase() : slugFromName(name);
  if (!slugAllowed(slug)) return { ok: false, reason: "slug" };
  const size = sizeOf(input.size);
  if (!size) return { ok: false, reason: "size" };
  const r = await pool.query<Row>(
    `INSERT INTO red_bag_workshops (slug, name, size, created_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO NOTHING RETURNING ${COLUMNS}`,
    [slug, name, size, input.by],
  );
  if (!r.rows[0]) return { ok: false, reason: "taken" };
  forgetRedBagWorkshops();
  return { ok: true, workshop: toWorkshop(r.rows[0]) };
}

/** Put a Workshop away (its link stops working; its gifts still count), or bring it back. */
export async function setRedBagWorkshopArchived(id: number, archived: boolean): Promise<RedBagWorkshop | null> {
  const r = await pool.query<Row>(
    `UPDATE red_bag_workshops SET archived_at = ${archived ? "COALESCE(archived_at, now())" : "NULL"} WHERE id = $1 RETURNING ${COLUMNS}`,
    [id],
  );
  forgetRedBagWorkshops();
  return r.rows[0] ? toWorkshop(r.rows[0]) : null;
}

// ------------------------------------------------------------------------------------------------
// The totals: paid Fill a Red Bag gifts since the season began, less refunds, the gift alone (as
// Admin > Overview counts them, src/db/overview-numbers.ts). One read: everyone's, and each company's.
// ------------------------------------------------------------------------------------------------

export interface WorkshopTotals {
  everyonePence: number;
  byWorkshopPence: Map<number, number>;
}

export const WORKSHOP_TOTALS_SQL = `SELECT red_bag_workshop_id AS workshop_id, COALESCE(SUM(GREATEST(amount_pence - refunded_amount_pence, 0)), 0) AS pence
  FROM donations
 WHERE payment_status = 'paid'
   AND source = 'red_bag'
   AND amount_pence > refunded_amount_pence
   AND created_at >= $1
 GROUP BY ROLLUP (red_bag_workshop_id)`;

/** The totals from the rows of WORKSHOP_TOTALS_SQL (the ROLLUP's grand total has no workshop and comes last). */
export function totalsFromRows(rows: { workshop_id: number | string | null; pence: number | string }[], grand = true): WorkshopTotals {
  const byWorkshopPence = new Map<number, number>();
  let everyonePence = 0;
  rows.forEach((row, i) => {
    const pence = Math.max(0, Number(row.pence) || 0);
    if (grand && i === rows.length - 1 && row.workshop_id == null) everyonePence = pence;
    else if (row.workshop_id != null) byWorkshopPence.set(Number(row.workshop_id), pence);
  });
  return { everyonePence, byWorkshopPence };
}

// ------------------------------------------------------------------------------------------------
// The public page's reads: a minute's cache, never a throw.
// ------------------------------------------------------------------------------------------------

const KEEP_MS = 60_000;
const WAIT_MS = 1500;

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`no answer in ${ms}ms`)), ms);
    if (typeof timer === "object" && typeof timer.unref === "function") timer.unref();
    work.then(
      (v) => {
        clearTimeout(timer);
        done(v);
      },
      (e) => {
        clearTimeout(timer);
        fail(e);
      },
    );
  });
}

/** One cached read: the last good value for a minute; on trouble the last good value, or `none`. */
function cachedRead<T>(read: () => Promise<T>, none: T) {
  let value: T | undefined;
  let at = 0;
  let pending: Promise<T> | null = null;
  return {
    get(): Promise<T> {
      if (value !== undefined && Date.now() - at < KEEP_MS) return Promise.resolve(value);
      if (!pending) {
        pending = within(read(), WAIT_MS)
          .then((v) => {
            value = v;
            at = Date.now();
            return v;
          })
          .catch((e: unknown) => {
            console.error(`[red-bag-workshops] read failed: ${(e as Error)?.message ?? e}`);
            at = Date.now(); // try again in a minute, not on every visit
            return value ?? none;
          })
          .finally(() => {
            pending = null;
          });
      }
      return pending;
    },
    forget(): void {
      value = undefined;
      at = 0;
      pending = null;
    },
  };
}

const live = cachedRead(async () => {
  const r = await pool.query<Row>(`SELECT ${COLUMNS} FROM red_bag_workshops WHERE archived_at IS NULL`);
  return new Map(r.rows.map((row) => [row.slug, toWorkshop(row)] as const));
}, new Map<string, RedBagWorkshop>());

const totals = cachedRead(async () => {
  const r = await pool.query<{ workshop_id: number | null; pence: string }>(WORKSHOP_TOTALS_SQL, [WORKSHOP_SEASON_FROM]);
  return totalsFromRows(r.rows);
}, { everyonePence: 0, byWorkshopPence: new Map<number, number>() } as WorkshopTotals);

/** A live (not archived) company Workshop by its link, or null. */
export async function findRedBagWorkshop(slug: string): Promise<RedBagWorkshop | null> {
  if (!slugAllowed(slug)) return null;
  return (await live.get()).get(slug) ?? null;
}

export function redBagWorkshopTotals(): Promise<WorkshopTotals> {
  return totals.get();
}

/** Forget what was read, so the next visit reads afresh (after an admin change, and for tests). */
export function forgetRedBagWorkshops(): void {
  live.forget();
  totals.forget();
}
