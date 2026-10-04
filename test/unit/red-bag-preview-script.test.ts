import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Fill a Red Bag: the small script the 404 at /fill (and /fill/thank-you) carries while the page is switched
// off (assets/js/red-bag-preview.js). With an admin session in the tab it asks for the page again
// with the token and shows it; with none it does nothing, so the public's 404 is left alone.

const { start } = createRequire(import.meta.url)(resolve(__dirname, "../../assets/js/red-bag-preview.js")) as {
  start: (doc: unknown, win: unknown) => Promise<boolean> | null;
};

function world(opts: { token?: string | null; status?: number; throws?: boolean; storageBlocked?: boolean }) {
  const doc = { open: vi.fn(), write: vi.fn(), close: vi.fn() };
  const fetch = vi.fn(async () => {
    if (opts.throws) throw new Error("offline");
    return { status: opts.status ?? 200, text: async () => "<html>the page</html>" };
  });
  const win = {
    fetch,
    location: { pathname: "/fill/thank-you", search: "?session_id=cs_test_abc" },
    sessionStorage: {
      getItem: (k: string) => {
        if (opts.storageBlocked) throw new Error("blocked");
        return k === "nbcc_admin_token" ? (opts.token ?? null) : null;
      },
    },
  };
  return { doc, win, fetch };
}

describe("the staff preview's way in", () => {
  it("does nothing at all for the public: no session, no request, the 404 untouched", () => {
    const { doc, win, fetch } = world({ token: null });
    expect(start(doc, win)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(doc.write).not.toHaveBeenCalled();
  });

  it("does nothing where the tab's storage cannot be read", () => {
    const { doc, win, fetch } = world({ storageBlocked: true });
    expect(start(doc, win)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks for the same address with the staff session, and shows the page that comes back", async () => {
    const { doc, win, fetch } = world({ token: "a-staff-token" });
    expect(await start(doc, win)).toBe(true);
    expect(fetch).toHaveBeenCalledWith("/fill/thank-you?session_id=cs_test_abc", { headers: { Authorization: "Bearer a-staff-token" }, cache: "no-store" });
    expect(doc.open).toHaveBeenCalled();
    expect(doc.write).toHaveBeenCalledWith("<html>the page</html>");
    expect(doc.close).toHaveBeenCalled();
  });

  it("leaves the 404 alone when the server says no (a session that has run out)", async () => {
    const { doc, win } = world({ token: "an-old-token", status: 404 });
    expect(await start(doc, win)).toBe(false);
    expect(doc.write).not.toHaveBeenCalled();
  });

  it("leaves the 404 alone when the request fails", async () => {
    const { doc, win } = world({ token: "a-staff-token", throws: true });
    expect(await start(doc, win)).toBe(false);
    expect(doc.write).not.toHaveBeenCalled();
  });
});
