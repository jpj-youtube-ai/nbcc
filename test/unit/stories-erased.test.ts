import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-475: an erased story stays erased, even if the old website's export is added again.
//
// Erasing a story remembers a one way fingerprint of it (a sha256 of the moment it was sent and its
// words, the same identity the import recognises a story by) in the stories database's
// erased_stories table, in the same transaction as the delete. The import then leaves out anything
// whose fingerprint is remembered. The stories pool is mocked at its boundary: no database here.
// Every story is invented.

const { queryMock, clientQuery, release } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../../src/db/stories-pool", () => ({
  storiesPool: { query: queryMock, connect: async () => ({ query: clientQuery, release }) },
}));

import { deleteStory, erasedStoriesAmong, insertImportedStories } from "../../src/db/stories";
import { erasedFingerprint, storyKey, type ImportedStory } from "../../src/stories/old-site-import";

const SENT = "2026-07-06T19:30:12.345Z";
const WORDS = "The Red Bag made our Christmas.";

// Answers each statement by what it says, and records the order they came in.
function database(answers: Array<[RegExp, unknown]>) {
  clientQuery.mockImplementation(async (sql: string) => {
    const hit = answers.find(([pattern]) => pattern.test(sql));
    return hit ? hit[1] : { rows: [], rowCount: 0 };
  });
}
const statements = () => clientQuery.mock.calls.map((c) => String(c[0]));
const index = (pattern: RegExp) => statements().findIndex((s) => pattern.test(s));

beforeEach(() => {
  queryMock.mockReset();
  clientQuery.mockReset();
  release.mockReset();
});

describe("erasing a story", () => {
  it("remembers its fingerprint, then deletes it, in one transaction", async () => {
    database([
      [/^SELECT created_at, story_text FROM stories/i, { rows: [{ created_at: new Date(SENT), story_text: WORDS }] }],
      [/^DELETE FROM stories/i, { rowCount: 1 }],
    ]);
    expect(await deleteStory(7)).toBe(true);

    const begin = index(/^BEGIN/);
    const read = index(/SELECT created_at, story_text FROM stories WHERE id = \$1 FOR UPDATE/i);
    const remember = index(/INSERT INTO erased_stories/i);
    const erase = index(/^DELETE FROM stories WHERE id = \$1/i);
    const commit = index(/^COMMIT/);
    expect([begin, read, remember, erase, commit].every((i) => i >= 0)).toBe(true);
    expect(begin).toBeLessThan(read);
    expect(read).toBeLessThan(remember);
    expect(remember).toBeLessThan(erase);
    expect(erase).toBeLessThan(commit);

    expect(clientQuery.mock.calls[read][1]).toEqual([7]);
    expect(clientQuery.mock.calls[remember][1]).toEqual([erasedFingerprint(SENT, WORDS)]);
    expect(clientQuery.mock.calls[erase][1]).toEqual([7]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("keeps nothing readable: the only value it remembers is 64 hex characters", async () => {
    database([
      [/^SELECT created_at, story_text FROM stories/i, { rows: [{ created_at: new Date(SENT), story_text: WORDS }] }],
      [/^DELETE FROM stories/i, { rowCount: 1 }],
    ]);
    await deleteStory(7);
    const remember = clientQuery.mock.calls.find((c) => /INSERT INTO erased_stories/i.test(String(c[0])))!;
    expect(remember[1]).toHaveLength(1);
    expect(remember[1][0]).toMatch(/^[0-9a-f]{64}$/);
    expect(String(remember[0])).toMatch(/ON CONFLICT \(fingerprint\) DO NOTHING/i);
  });

  it("returns false, remembers nothing and rolls back when there is no such story", async () => {
    database([]);
    expect(await deleteStory(404)).toBe(false);
    expect(index(/INSERT INTO erased_stories/i)).toBe(-1);
    expect(index(/^DELETE FROM stories/i)).toBe(-1);
    expect(index(/^ROLLBACK/)).toBeGreaterThan(-1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rolls back, so the story is not deleted, when the fingerprint cannot be remembered", async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (/^SELECT created_at/i.test(sql)) return { rows: [{ created_at: new Date(SENT), story_text: WORDS }] };
      if (/INSERT INTO erased_stories/i.test(sql)) throw new Error("no such table");
      return { rows: [], rowCount: 0 };
    });
    await expect(deleteStory(7)).rejects.toThrow("no such table");
    expect(index(/^DELETE FROM stories/i)).toBe(-1);
    expect(index(/^COMMIT/)).toBe(-1);
    expect(index(/^ROLLBACK/)).toBeGreaterThan(-1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("never touches the audit_log table (no cross database audit for stories)", async () => {
    database([
      [/^SELECT created_at, story_text FROM stories/i, { rows: [{ created_at: new Date(SENT), story_text: WORDS }] }],
      [/^DELETE FROM stories/i, { rowCount: 1 }],
    ]);
    await deleteStory(7);
    expect(statements().some((s) => /audit_log/i.test(s))).toBe(false);
  });
});

describe("which stories in a file were erased earlier", () => {
  it("asks the stories database by fingerprint only, and answers with the import's own keys", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ fingerprint: erasedFingerprint(SENT, WORDS) }] });
    const lookups = [
      { created_at: SENT, story_text: WORDS },
      { created_at: "2026-07-07T09:00:00.000Z", story_text: "We volunteer every year." },
    ];
    const erased = await erasedStoriesAmong(lookups);
    expect(erased).toEqual(new Set([storyKey(SENT, WORDS)]));

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/FROM erased_stories WHERE fingerprint = ANY\(\$1::text\[\]\)/i);
    expect(params).toEqual([lookups.map((l) => erasedFingerprint(l.created_at, l.story_text))]);
    expect(JSON.stringify(params)).not.toMatch(/Red Bag|volunteer/);
  });

  it("does not ask at all for an empty file", async () => {
    expect(await erasedStoriesAmong([])).toEqual(new Set());
    expect(queryMock).not.toHaveBeenCalled();
  });
});

describe("adding stories from the old website", () => {
  const story = (sent: string, words: string): ImportedStory => ({
    created_at: sent,
    consent_captured_at: sent,
    story_text: words,
    short_quote: null,
    use_scope: "public",
    consent_share_first_name: true,
    consent_share_town: true,
    contact_for_more: false,
    submitter_first_name: "Morag",
    submitter_email: null,
    submitter_phone: null,
    submitter_town: "Irvine",
    age_band: null,
    gender: null,
    recipient_type: null,
    heard_about: null,
    confirmed_over_16: true,
    admin_notes: "Brought in from the old website.",
  });

  it("looks again inside the lock, and never adds a story erased in the meantime", async () => {
    database([[/FROM erased_stories/i, { rows: [{ fingerprint: erasedFingerprint(SENT, WORDS) }] }]]);
    const added = await insertImportedStories([story(SENT, WORDS), story("2026-07-07T09:00:00.000Z", "We volunteer every year.")]);
    expect(added).toBe(1);

    const inserts = clientQuery.mock.calls.filter((c) => /^\s*INSERT INTO stories/i.test(String(c[0])));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1][2]).toBe("We volunteer every year.");
    expect(index(/pg_advisory_xact_lock/i)).toBeLessThan(index(/FROM erased_stories/i));
    expect(index(/^COMMIT/)).toBeGreaterThan(-1);
  });
});
