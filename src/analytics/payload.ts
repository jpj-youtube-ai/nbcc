// TASK-479: what assets/js/pulse.js may send to POST /api/pulse. Anything that does not fit, or is
// over 2 KB, is dropped without a word: the page never learns whether it was kept.
import { z } from "zod";

export const PULSE_MAX_BYTES = 2048;

export const CLICK_KINDS = ["donate", "tickets", "phone", "email", "download", "outbound"] as const;
export type ClickKind = (typeof CLICK_KINDS)[number];

// The page's own random id for one view: 8 random bytes as hex, kept in the page's memory only.
const viewId = z.string().regex(/^[0-9a-f]{16}$/);
const short = z.string().max(200);
const whole = (max: number) =>
  z
    .number()
    .finite()
    .min(0)
    .transform((n) => Math.min(max, Math.round(n)));

const View = z.object({
  t: z.literal("view"),
  v: viewId,
  p: z.string().max(1024),
  r: z.string().max(1024).default(""),
  u: z
    .object({ s: short.optional(), m: short.optional(), c: short.optional() })
    .default({}),
  w: z.number().int().min(0).max(100_000).optional(),
});

const Leave = z.object({ t: z.literal("leave"), v: viewId, a: whole(1800), s: whole(100) });

const Click = z.object({
  t: z.literal("click"),
  v: viewId,
  k: z.enum(CLICK_KINDS),
  l: z
    .string()
    .max(1000)
    .transform((s) => s.slice(0, 80)),
});

const Pulse = z.discriminatedUnion("t", [View, Leave, Click]);

export type PulseEvent = z.infer<typeof Pulse>;
export type ViewEvent = z.infer<typeof View>;

export function parsePulse(body: string): PulseEvent | null {
  if (typeof body !== "string" || Buffer.byteLength(body, "utf8") > PULSE_MAX_BYTES) return null;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = Pulse.safeParse(json);
  return parsed.success ? parsed.data : null;
}
