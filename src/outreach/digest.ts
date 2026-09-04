import type { Todo } from "./todo";

// TASK-415: the Monday note telling a volunteer what is waiting for them.
//
// Pure - no pool, no config, no clock of its own - so who gets one, and what it says, is
// unit-tested without a database or a mail account (golden rule 5).
//
// The whole point is that "Needs you today" only works for somebody who opens it. Volunteers here
// are busy with jobs and lives; a list nobody visits is a list nobody acts on. So once a week the
// list comes to them instead.
//
// It is a nudge, not a report. Everything in it is a count and a link, because the moment it needs
// reading properly it becomes another thing to put off.

/** Monday. A week's work is easiest to think about before the week starts. */
export const DIGEST_WEEKDAY = 1;

export interface DigestRecipient {
  name: string;
  email: string;
}

export interface Digest {
  email: string;
  name: string;
  subject: string;
  /** The counts, most urgent first, already worded. */
  lines: string[];
  total: number;
}

/** Is today the day? Sunday is 0, so Monday is 1. */
export function isDigestDay(now: Date): boolean {
  return now.getUTCDay() === DIGEST_WEEKDAY;
}

const PHRASES: Record<Todo["kind"], (n: number) => string> = {
  "ask-again": (n) => `${n} ${n === 1 ? "business" : "businesses"} asked us to come back around now`,
  call: (n) => `${n} worth a call: interested, and gone quiet`,
  nudge: (n) => `${n} ${n === 1 ? "has" : "have"} not replied, and could have one last note`,
  send: (n) => `${n} ready to send, with an address and nothing sent yet`,
  "find-address": (n) => `${n} waiting on an email address`,
};

/** Most important first, matching the order the list itself uses. */
const ORDER: Todo["kind"][] = ["ask-again", "call", "nudge", "send", "find-address"];

/**
 * One digest per volunteer who has something waiting, and none for anybody who does not.
 *
 * Silence is the feature. An email that arrives every Monday saying "you have nothing to do"
 * teaches people to delete it unread, and then the one that matters goes with it.
 *
 * Unassigned work is deliberately NOT mailed to everybody: five volunteers each getting the same
 * list of nobody's businesses is how five people each assume one of the others has it. It stays on
 * the screen, where it is visible without being pushed at anybody.
 */
export function buildDigests(todos: Todo[], volunteers: DigestRecipient[]): Digest[] {
  const byOwner = new Map<string, Todo[]>();
  for (const todo of todos) {
    if (!todo.ownerEmail) continue;
    const list = byOwner.get(todo.ownerEmail) ?? [];
    list.push(todo);
    byOwner.set(todo.ownerEmail, list);
  }

  const digests: Digest[] = [];
  for (const volunteer of volunteers) {
    const mine = byOwner.get(volunteer.email);
    if (!mine || !mine.length) continue;

    const counts = new Map<Todo["kind"], number>();
    for (const t of mine) counts.set(t.kind, (counts.get(t.kind) ?? 0) + 1);

    const lines = ORDER.filter((kind) => counts.has(kind)).map((kind) =>
      PHRASES[kind](counts.get(kind) as number),
    );

    digests.push({
      email: volunteer.email,
      name: volunteer.name,
      // The count goes in the subject so it can be judged without opening it, which is the whole
      // job of a subject line on a weekly nudge.
      subject: `${mine.length} ${mine.length === 1 ? "business" : "businesses"} waiting on you`,
      lines,
      total: mine.length,
    });
  }
  return digests;
}

export interface DigestPassResult {
  volunteers: number;
  sent: number;
  failed: number;
  skipped: boolean;
}

export interface DigestPassDeps {
  listTodos: () => Promise<Todo[]>;
  listVolunteers: () => Promise<DigestRecipient[]>;
  send: (digest: Digest) => Promise<void>;
  now: Date;
}

/**
 * One weekly pass, run from the daily task.
 *
 * Riding the daily schedule and checking the weekday here is deliberate: a second EventBridge rule
 * would be a second thing to notice had stopped, and this one is quiet enough that nobody would.
 */
export async function runDigestPass(deps: DigestPassDeps): Promise<DigestPassResult> {
  if (!isDigestDay(deps.now)) {
    return { volunteers: 0, sent: 0, failed: 0, skipped: true };
  }

  const [todos, volunteers] = await Promise.all([deps.listTodos(), deps.listVolunteers()]);
  const digests = buildDigests(todos, volunteers);

  let sent = 0;
  let failed = 0;
  for (const digest of digests) {
    try {
      await deps.send(digest);
      sent += 1;
    } catch (err) {
      // One bad address must not stop the others hearing.
      failed += 1;
      console.error(`digest failed for ${digest.email}:`, err instanceof Error ? err.message : err);
    }
  }
  return { volunteers: digests.length, sent, failed, skipped: false };
}
