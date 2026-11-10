import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 07700 900 123 is Ofcom's reserved drama range: never a real person's number.
const GOOD = "+447700900123";

async function load(over: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock("../../src/config", () => ({
    config: {
      SMS_PROVIDER: "stub",
      SMS_SENDER_ID: "NBCC",
      SMS_REGION: "eu-west-2",
      NODE_ENV: "development",
      AWS_ACCESS_KEY_ID: "AKIDEXAMPLE",
      AWS_SECRET_ACCESS_KEY: "secret-example",
      ...over,
    },
  }));
  return import("../../src/clients/sms");
}

describe("sendText", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("../../src/config");
  });

  it("refuses a number that is not +447 and nine digits, before any fetch", async () => {
    const { sendText } = await load({ SMS_PROVIDER: "sns" });
    const fetchImpl = vi.fn();
    await expect(
      sendText({ to: "07700 900 123", text: "hi", senderId: "NBCC" }, { fetchImpl: fetchImpl as never }),
    ).rejects.toThrow("not a UK mobile");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("answers stubbed and never calls fetch with the stub outside production", async () => {
    const { sendText, smsConfigured } = await load({ SMS_PROVIDER: "stub", NODE_ENV: "development" });
    const fetchImpl = vi.fn();
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    try {
      expect(smsConfigured).toBe(false);
      await expect(
        sendText({ to: GOOD, text: "hi", senderId: "NBCC" }, { fetchImpl: fetchImpl as never }),
      ).resolves.toBe("stubbed");
      await expect(sendText({ to: GOOD, text: "hi", senderId: "NBCC" })).resolves.toBe("stubbed");
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("posts one signed form to SNS and answers sent", async () => {
    const { sendText, smsConfigured } = await load({ SMS_PROVIDER: "sns" });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<ok/>", { status: 200 }));
    expect(smsConfigured).toBe(true);
    await expect(
      sendText({ to: GOOD, text: "hi", senderId: "NBCC" }, { fetchImpl: fetchImpl as never }),
    ).resolves.toBe("sent");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://sns.eu-west-2.amazonaws.com/");
    expect(init.method).toBe("POST");
    const headers = Object.fromEntries(
      Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    );
    expect(headers["authorization"]).toMatch(/^AWS4-HMAC-SHA256/);
    expect(headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(init.body).toContain("Action=Publish");
  });

  it("logs no more than the last three digits of the number", async () => {
    const { sendText } = await load({ SMS_PROVIDER: "sns" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<ok/>", { status: 200 }));
    await sendText({ to: GOOD, text: "hi", senderId: "NBCC" }, { fetchImpl: fetchImpl as never });
    const line = log.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(line).toContain("text sent to …123");
    expect(line).not.toContain("7700900");
  });

  it("throws with the status when Amazon refuses", async () => {
    const { sendText } = await load({ SMS_PROVIDER: "sns" });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("InvalidParameter", { status: 400 }));
    await expect(
      sendText({ to: GOOD, text: "hi", senderId: "NBCC" }, { fetchImpl: fetchImpl as never }),
    ).rejects.toThrow("SNS publish responded 400");
  });

  it("throws with the status on a 5xx too", async () => {
    const { sendText } = await load({ SMS_PROVIDER: "sns" });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("ServiceUnavailable", { status: 503 }));
    await expect(
      sendText({ to: GOOD, text: "hi", senderId: "NBCC" }, { fetchImpl: fetchImpl as never }),
    ).rejects.toThrow("SNS publish responded 503");
  });

  it("keeps only the last three digits of a number Amazon echoes back in its refusal", async () => {
    const { sendText } = await load({ SMS_PROVIDER: "sns" });
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("Invalid parameter: PhoneNumber Reason: +447700900123 is not valid", { status: 400 }));
    const err = await sendText({ to: GOOD, text: "hi", senderId: "NBCC" }, { fetchImpl: fetchImpl as never }).catch(
      (e: Error) => e,
    );
    expect((err as Error).message).toContain("400");
    expect((err as Error).message).toContain("…123");
    expect((err as Error).message).not.toContain("7700900");
  });

  it("never stubs in production", async () => {
    const { sendText } = await load({ SMS_PROVIDER: "stub", NODE_ENV: "production" });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<ok/>", { status: 200 }));
    await expect(
      sendText({ to: GOOD, text: "hi", senderId: "NBCC" }, { fetchImpl: fetchImpl as never }),
    ).resolves.toBe("sent");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
