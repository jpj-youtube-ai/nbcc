import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("../../src/config", () => ({ config: { NODE_ENV: "development", DATABASE_URL: "postgres://localhost/test" } }));
vi.mock("../../src/db/pool", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));

import { createPulseRouter } from "../../src/routes/pulse";
import type { PulseRequest } from "../../src/analytics/pulse-handler";

// TASK-479: POST /api/pulse always answers 204 with an empty body, whatever happens behind it, so
// a page can never tell whether its event was kept, and never shows an error for one.

let server: Server | null = null;
afterEach(() => {
  server?.close();
  server = null;
});

async function start(handle: (req: PulseRequest) => Promise<unknown>) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(createPulseRouter(handle));
  app.use(express.json());
  server = app.listen(0);
  await new Promise((r) => server!.once("listening", r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/pulse`;
}

const send = (url: string, body: string, type = "text/plain;charset=UTF-8") =>
  fetch(url, { method: "POST", body, headers: { "content-type": type, "user-agent": "ExampleBrowser/1.0" } });

describe("POST /api/pulse", () => {
  it("hands the text body, address and browser to the handler and answers 204", async () => {
    const handle = vi.fn(async () => "kept");
    const url = await start(handle);
    const res = await send(url, '{"t":"view"}');
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(handle).toHaveBeenCalledTimes(1);
    const arg = handle.mock.calls[0][0] as { body: string; userAgent: string; ip: string; host: string };
    expect(arg.body).toBe('{"t":"view"}');
    expect(arg.userAgent).toBe("ExampleBrowser/1.0");
    expect(arg.ip).toMatch(/127\.0\.0\.1/);
    expect(arg.host).toBe("127.0.0.1");
  });

  it("hands over the headers that say where the event came from and what the browser asked", async () => {
    const handle = vi.fn(async () => "kept");
    const url = await start(handle);
    await fetch(url, {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "text/plain",
        "sec-fetch-site": "same-origin",
        origin: "https://nbcc.scot",
        referer: "https://nbcc.scot/donate",
        dnt: "1",
        "sec-gpc": "1",
      },
    });
    expect((handle.mock.calls[0] as unknown[])[0]).toMatchObject({
      headers: { secFetchSite: "same-origin", origin: "https://nbcc.scot", referer: "https://nbcc.scot/donate", dnt: "1", secGpc: "1" },
    });
  });

  it("reads a body sent as JSON the same way", async () => {
    const handle = vi.fn(async () => "kept");
    const url = await start(handle);
    expect((await send(url, '{"t":"view"}', "application/json")).status).toBe(204);
    expect((handle.mock.calls[0] as unknown[])[0]).toMatchObject({ body: '{"t":"view"}' });
  });

  it("answers 204 and keeps nothing for a body over 2 KB", async () => {
    const handle = vi.fn(async () => "kept");
    const url = await start(handle);
    const res = await send(url, "x".repeat(5000));
    expect(res.status).toBe(204);
    expect(handle).not.toHaveBeenCalled();
  });

  it("answers 204 even when the handler fails", async () => {
    const url = await start(async () => {
      throw new Error("database down");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await send(url, "{}")).status).toBe(204);
    spy.mockRestore();
  });
});
