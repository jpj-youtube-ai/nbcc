import type { CalendarView } from "./pages/types";

// NBCC Elf Detective School: the public calendar, built once and shared. The plan is
// docs/superpowers/plans/2026-11-10-elf-wave-2-game-1.md (Task 7).
//
// The calendar is the same for every visitor, so on a busy evening it would be wasteful to read every
// door, finder and scrapbook again for each page and each poll of the calendar's script. Here it is
// built at most once every 15 seconds in this process, and everyone who asks in that time is handed
// the same calendar. A build that is still going is waited for, never started a second time, and a
// build that fails is not kept, so the next visitor tries again. The routes (src/routes/elf.ts) say
// how a calendar is built; this only says when.
//
// It never holds anything private: the practice door and every family's own marks stay out of it.
//
// Pure apart from the build it is handed. Unit tested in test/unit/elf-public-calendar.test.ts.

/** How long one build of the calendar is shared for. */
export const CALENDAR_CACHE_MS = 15_000;

export function makePublicCalendar(deps: { load: (now: Date) => Promise<CalendarView> }): { get(now: Date): Promise<CalendarView> } {
  let kept: { builtAt: number; view: Promise<CalendarView> } | null = null;
  return {
    get(now: Date): Promise<CalendarView> {
      const t = now.getTime();
      // A clock that reads earlier than the last build is never handed a calendar from its future.
      if (kept && t >= kept.builtAt && t - kept.builtAt < CALENDAR_CACHE_MS) return kept.view;
      const entry = { builtAt: t, view: deps.load(now) };
      kept = entry;
      entry.view.catch(() => {
        if (kept === entry) kept = null;
      });
      return entry.view;
    },
  };
}
