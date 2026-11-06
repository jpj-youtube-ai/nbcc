import { describe, it, expect, vi, beforeEach } from "vitest";

// The Donations gift log's list (docs/superpowers/plans/2026-11-05-donations-screen.md, Task 3): more
// of each gift on every row, and more filters. DB-free: the pool is mocked and the SQL read back, as
// test/unit/donations-mode-filter.test.ts does. Every value a filter takes is checked against a fixed
// list, and junk reads as "no filter", never as an empty list. Names and addresses are invented.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock("../../src/db/pool", () => ({ pool: { query: queryMock, connect: vi.fn() } }));
vi.mock("../../src/config", () => ({
  config: { NODE_ENV: "development", DATABASE_URL: "postgres://localhost:5432/test" },
}));

import { listDonations } from "../../src/db/admin";

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [{ count: 0 }], rowCount: 1 });
});

const call = (i: number) => {
  const [sql, params] = queryMock.mock.calls[i];
  return { sql: String(sql).replace(/\s+/g, " ").trim(), params: params as unknown[] };
};
const count = () => call(0);
const page = () => call(1);

// The output columns of one SELECT, by name: split at the commas outside brackets, up to its last
// FROM outside brackets.
function columnsOf(select: string): string[] {
  const body = select.replace(/^\s*SELECT\s+/i, "");
  const cols: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && body.startsWith(" FROM ", i)) break;
    if (depth === 0 && ch === ",") {
      cols.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cols.push(cur.trim());
  return cols.map((c) => {
    const as = / AS (\w+)$/i.exec(c);
    return as ? as[1] : c.slice(c.lastIndexOf(".") + 1);
  });
}
const halves = () => {
  const inner = /^SELECT \* FROM \((.*)\) listed ORDER BY/.exec(page().sql);
  if (!inner) throw new Error(`not the list's shape: ${page().sql}`);
  return inner[1].split(" UNION ALL ");
};

describe("each row carries more of the gift", () => {
  it("selects the new columns on a gift, with its fundraiser, pledge and donor", async () => {
    await listDonations({});
    const [gifts] = halves();
    for (const part of [
      "d.fee_cover_pence",
      "d.arrival_channel",
      "d.arrival_source",
      "d.arrival_campaign",
      "d.given_on",
      "d.pay_method",
      "d.pay_wallet",
      "d.card_brand",
      "d.card_last4",
      "fr.title AS fundraiser_title",
      "fr.slug AS fundraiser_slug",
      "dn.donor_type",
      "dn.business_name",
      "LEFT JOIN fundraisers fr ON fr.id = d.fundraiser_id",
    ]) {
      expect(gifts, part).toContain(part);
    }
    // At most one pledge per gift, so a row is never doubled.
    expect(gifts).toContain("(SELECT sp.id FROM sponsor_pledges sp WHERE sp.donation_id = d.id ORDER BY sp.id LIMIT 1) AS pledge_id");
  });

  it("gives both halves of the list the same columns in the same order", async () => {
    await listDonations({});
    const [gifts, elves] = halves();
    expect(columnsOf(elves)).toEqual(columnsOf(gifts));
    expect(columnsOf(gifts)).toContain("pledge_id");
  });

  it("gives an elf payment typed empties for what only a gift has", async () => {
    await listDonations({});
    const [, elves] = halves();
    for (const part of [
      "NULL::text AS arrival_channel",
      "NULL::text AS pay_method",
      "NULL::text AS card_last4",
      "NULL::text AS fundraiser_title",
      "NULL::int AS pledge_id",
      "NULL::text AS donor_type",
      "o.fee_cover_pence AS fee_cover_pence",
    ]) {
      expect(elves, part).toContain(part);
    }
  });

  it("adds the plain words for where it was given and how it was paid to every row", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ count: 2 }] }).mockResolvedValueOnce({
      rows: [
        { kind: "donation", id: 1, source: "red_bag", payment_channel: "online", invoice_id: null, fundraiser_title: null, pledge_id: null, pay_method: "card", pay_wallet: "apple_pay", card_brand: "visa", card_last4: "4242" },
        { kind: "elf", id: 9, source: "elf_school", payment_channel: "online", invoice_id: null, fundraiser_title: null, pledge_id: null, pay_method: null, pay_wallet: null, card_brand: null, card_last4: null },
      ],
    });
    const out = await listDonations({});
    expect(out.results[0]).toMatchObject({ given_on_label: "Fill a Red Bag", paid_by_label: "Apple Pay (Visa ending 4242)" });
    expect(out.results[1]).toMatchObject({ given_on_label: "Elf Detective School", paid_by_label: null });
  });

  it("keeps newest first", async () => {
    await listDonations({ q: "sam" });
    expect(page().sql).toMatch(/ORDER BY listed\.created_at DESC, listed\.kind = 'elf', listed\.id DESC LIMIT 50 OFFSET 0$/);
  });
});

describe("search by name or email", () => {
  it("matches a gift's donor and an elf payment's grown up with one parameter", async () => {
    await listDonations({ q: "Sam" });
    for (const q of [count(), page()]) {
      expect(q.params).toEqual(["%Sam%"]);
      expect(q.sql).toContain("(dn.full_name ILIKE $1 OR dn.email ILIKE $1)");
      expect(q.sql).toContain("(f.grown_up_name ILIKE $1 OR f.email ILIKE $1)");
    }
    // The count has to reach the donor's name too.
    expect(count().sql).toContain("FROM donations d JOIN donors dn ON dn.id = d.donor_id");
  });

  it("takes the characters ILIKE treats as wild literally", async () => {
    await listDonations({ q: "50%_off\\now" });
    expect(count().params).toEqual(["%50\\%\\_off\\\\now%"]);
  });

  it("trims, and keeps at most 100 characters", async () => {
    await listDonations({ q: `  ${"a".repeat(150)}  ` });
    expect(count().params).toEqual([`%${"a".repeat(100)}%`]);
  });

  it.each(["", "   "])("is no filter when empty: %j", async (q) => {
    await listDonations({ q });
    expect(count().params).toEqual([]);
    expect(count().sql).not.toContain("ILIKE");
  });

  it("searches elf payments alone with only its own value", async () => {
    await listDonations({ q: "sam@example.com", source: "elf_school" });
    for (const q of [count(), page()]) {
      expect(q.sql).not.toContain("FROM donations d");
      expect(q.sql).toContain("(f.grown_up_name ILIKE $1 OR f.email ILIKE $1)");
      expect(q.params).toEqual(["%sam@example.com%"]);
    }
  });
});

describe("from and to, by the UK date", () => {
  it("takes both days inclusive, on gifts and on elf payments", async () => {
    await listDonations({ from: "2026-11-01", to: "2026-11-05" });
    for (const q of [count(), page()]) {
      expect(q.params).toEqual(["2026-11-01", "2026-11-05"]);
      expect(q.sql).toContain("(d.created_at AT TIME ZONE 'Europe/London')::date >= $1::date");
      expect(q.sql).toContain("(d.created_at AT TIME ZONE 'Europe/London')::date <= $2::date");
      expect(q.sql).toContain("(COALESCE(o.paid_at, o.created_at) AT TIME ZONE 'Europe/London')::date >= $1::date");
      expect(q.sql).toContain("(COALESCE(o.paid_at, o.created_at) AT TIME ZONE 'Europe/London')::date <= $2::date");
    }
  });

  it.each(["yesterday", "2026-13-01", "2026-02-30", "2026-1-5", "05/11/2026", "2026-11-05T00:00"])("ignores a date that is not a real one: %j", async (junk) => {
    await listDonations({ from: junk, to: junk });
    expect(count().params).toEqual([]);
    expect(count().sql).not.toContain("Europe/London");
  });
});

describe("paid by", () => {
  it.each([
    ["card", "d.pay_method = $1 AND (d.pay_wallet IS NULL OR d.pay_wallet NOT IN ('apple_pay', 'google_pay'))", ["card"]],
    ["apple_pay", "d.pay_method = 'card' AND d.pay_wallet = $1", ["apple_pay"]],
    ["google_pay", "d.pay_method = 'card' AND d.pay_wallet = $1", ["google_pay"]],
    ["bacs_debit", "d.pay_method = $1", ["bacs_debit"]],
    ["bank_transfer", "d.pay_method = $1", ["bank_transfer"]],
    ["card_present", "(d.pay_method = $1 OR (d.pay_method IS NULL AND d.payment_channel = 'in_person'))", ["card_present"]],
  ])("narrows to %s, and leaves elf payments out", async (method, where, params) => {
    await listDonations({ method });
    expect(count().sql).toContain(where);
    expect(count().params).toEqual(params);
    expect(page().sql).not.toContain("elf_orders");
  });

  it.each(["", "cash", "CARD", "card' OR '1'='1"])("ignores a method not on the list: %j", async (method) => {
    await listDonations({ method });
    expect(count().sql).not.toContain("pay_method");
    expect(page().sql).toContain("elf_orders");
  });
});

describe("came from", () => {
  it.each(["qr", "email", "newsletter", "search", "social", "other_websites", "direct", "site"])("narrows to %s, and leaves elf payments out", async (came) => {
    await listDonations({ came });
    expect(count().sql).toContain("d.arrival_channel = $1");
    expect(count().params).toEqual([came]);
    expect(page().sql).not.toContain("elf_orders");
  });

  it("finds gifts where nothing was noted", async () => {
    await listDonations({ came: "unknown" });
    expect(count().sql).toContain("d.arrival_channel IS NULL");
    expect(count().params).toEqual([]);
  });

  it.each(["", "QR", "internal", "facebook"])("ignores a channel not on the list: %j", async (came) => {
    await listDonations({ came });
    expect(count().sql).not.toContain("arrival_channel");
  });
});

describe("Gift Aid", () => {
  it("narrows to gifts with it, and leaves elf payments out", async () => {
    await listDonations({ giftAid: "yes" });
    expect(count().sql).toContain("d.gift_aid = true");
    expect(page().sql).not.toContain("elf_orders");
  });

  it("narrows to gifts without it", async () => {
    await listDonations({ giftAid: "no" });
    expect(count().sql).toContain("d.gift_aid = false");
  });

  it.each(["", "true", "maybe"])("ignores anything else: %j", async (giftAid) => {
    await listDonations({ giftAid });
    expect(count().sql).not.toContain("gift_aid");
  });
});

describe("the new places a gift can be given", () => {
  it.each([
    ["donate_page", "d.source IS NULL AND d.payment_channel = 'online' AND d.fundraiser_id IS NULL AND d.invoice_id IS NULL"],
    ["fundraiser", "d.fundraiser_id IS NOT NULL"],
    ["card_reader", "d.payment_channel = 'in_person'"],
  ])("narrows to %s, and leaves elf payments out", async (source, where) => {
    await listDonations({ source });
    for (const q of [count(), page()]) {
      expect(q.sql).toContain(where);
      expect(q.sql).not.toContain("elf_orders");
      expect(q.params).toEqual([]);
    }
  });
});

describe("every filter together", () => {
  it("keeps each placeholder on its own value, the old filters first", async () => {
    await listDonations({
      status: "eligible",
      channel: "online",
      paymentStatus: "paid",
      mode: "once",
      source: "red_bag",
      q: "sam",
      from: "2026-11-01",
      to: "2026-11-05",
      method: "apple_pay",
      came: "qr",
      giftAid: "yes",
    });
    const { sql, params } = count();
    expect(params).toEqual(["eligible", "online", "paid", "once", "red_bag", "%sam%", "2026-11-01", "2026-11-05", "apple_pay", "qr"]);
    expect(sql).toContain("d.source = $5");
    expect(sql).toContain("dn.full_name ILIKE $6");
    expect(sql).toContain("::date >= $7::date");
    expect(sql).toContain("::date <= $8::date");
    expect(sql).toContain("d.pay_wallet = $9");
    expect(sql).toContain("d.arrival_channel = $10");
  });

  it("shares search and dates between gifts and elf payments by the same placeholders", async () => {
    await listDonations({ mode: "once", q: "sam", from: "2026-11-01" });
    const { sql, params } = page();
    expect(params).toEqual(["once", "%sam%", "2026-11-01"]);
    expect(sql).toContain("(f.grown_up_name ILIKE $2 OR f.email ILIKE $2)");
    expect(sql).toContain("(COALESCE(o.paid_at, o.created_at) AT TIME ZONE 'Europe/London')::date >= $3::date");
  });
});
