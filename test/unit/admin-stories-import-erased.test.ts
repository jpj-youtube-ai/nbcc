import { describe, it, expect, vi, beforeEach } from "vitest";

// TASK-475: POST /api/admin/stories/import leaves out a story that was erased earlier, and the
// preview says so among the rows left out. The database and the permission check are mocked at
// their boundaries; every person and story here is invented.

const { alreadyHereMock, erasedMock, insertMock } = vi.hoisted(() => ({
  alreadyHereMock: vi.fn(),
  erasedMock: vi.fn(),
  insertMock: vi.fn(),
}));
vi.mock("../../src/db/stories", () => ({
  storiesAlreadyHere: alreadyHereMock,
  erasedStoriesAmong: erasedMock,
  insertImportedStories: insertMock,
}));
vi.mock("../../src/routes/admin-authz", () => ({
  authorizeSection: async () => ({ email: "editor@example.com" }),
}));

import { postStoriesImport } from "../../src/routes/admin-stories-import";
import { storyKey, ERASED_EARLIER } from "../../src/stories/old-site-import";

const ERASED_AT = "2026-07-06T19:30:12.345Z";
const ERASED_WORDS = "The Red Bag made our Christmas.";
const CSV =
  [
    "Submission date,Your story,Are you happy for us to share your story publicly?,I confirm that I am over 16,First name (leave this blank if you wish to be anonymous),Email (optional)",
    `${ERASED_AT},${ERASED_WORDS},Yes,Checked,Morag,morag@example.com`,
    "2026-07-07T09:00:00.000Z,We volunteer every year.,Yes,Checked,Callum,callum@example.com",
  ].join("\r\n") + "\r\n";

type Res = { statusCode: number; body: any; status: (c: number) => Res; json: (b: unknown) => Res }; // eslint-disable-line @typescript-eslint/no-explicit-any
function mockRes(): Res {
  const res = { statusCode: 200, body: undefined } as Res;
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}
async function post(body: unknown): Promise<Res> {
  const res = mockRes();
  await postStoriesImport({ body, headers: {} } as never, res as never);
  return res;
}

beforeEach(() => {
  alreadyHereMock.mockReset().mockResolvedValue(new Set());
  erasedMock.mockReset().mockResolvedValue(new Set([storyKey(ERASED_AT, ERASED_WORDS)]));
  insertMock.mockReset().mockImplementation(async (stories: unknown[]) => stories.length);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("adding the old export again after a story was erased", () => {
  it("shows the erased story among the rows left out, with a plain reason", async () => {
    const res = await post({ csv: CSV });
    expect(res.statusCode).toBe(200);
    expect(res.body.adding.map((a: { firstName: string }) => a.firstName)).toEqual(["Callum"]);
    expect(res.body.skipping).toEqual([
      { row: 1, sentOn: "6 July 2026", firstName: "Morag", town: "", reason: ERASED_EARLIER },
    ]);
    expect(erasedMock).toHaveBeenCalledWith([
      { created_at: ERASED_AT, story_text: ERASED_WORDS },
      { created_at: "2026-07-07T09:00:00.000Z", story_text: "We volunteer every year." },
    ]);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("never saves the erased story when adding", async () => {
    const res = await post({ csv: CSV, commit: true });
    expect(res.statusCode).toBe(200);
    expect(res.body.added).toBe(1);
    const saved = insertMock.mock.calls[0][0] as Array<{ story_text: string }>;
    expect(saved.map((s) => s.story_text)).toEqual(["We volunteer every year."]);
  });

  it("saves nothing, and says so, when the erased stories cannot be checked", async () => {
    erasedMock.mockReset().mockRejectedValue(new Error("no such table"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await post({ csv: CSV, commit: true });
    expect(res.statusCode).toBe(500);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
