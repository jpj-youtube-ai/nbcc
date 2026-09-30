# "New" pills in the admin, per person: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each staff member sees a New pill on the admin sections that hold something they have not
seen, and on the new rows inside them. Opening a section clears its pill for that person only.

**Architecture:**
- **Pure rules** (`src/admin/whats-new.ts`): the areas, their access gates, the features list, the
  last-visit times and the "is it new" decision.
- **SQL** (`src/db/whats-new.ts`): the seen rows, plus one "latest arrival since" query per area on
  the right database pool.
- **Routes** (`src/routes/admin-whats-new.ts`): a GET for the list and a POST for "seen".
- **Browser** (`assets/js/admin/app.js`): draws the menu pills and row pills, and records visits.

**Tech stack:** Express and zod, node-pg-migrate (CommonJS) and pg, with Vitest (unit and jsdom)
and Cucumber (database, CI only).

Spec: `docs/superpowers/specs/2026-09-30-admin-new-pills-design.md`.

## Files

| File | Change |
|---|---|
| `migrations/1791000000000_admin-seen.js` | new: the `admin_seen` table |
| `src/admin/whats-new.ts` | new: pure rules |
| `src/db/whats-new.ts` | new: SQL |
| `src/routes/admin-whats-new.ts` | new: routes |
| `src/app.ts` | mount the router |
| `assets/js/admin/app.js` | the pills, and recording visits |
| `assets/css/admin.css` | `.admin-new-pill` |
| `test/unit/whats-new.test.ts` | new: the rules |
| `test/unit/admin-whats-new-routes.test.ts` | new: routes, with the db mocked |
| `test/unit/admin-app.test.ts` | the browser pills (jsdom) |
| `features/whats-new.feature` and `features/steps/whats-new.steps.js` | new: per person, against a real database |
| `README.md` | a new section |

## Tasks (each is test first, then code; commit after each)

### Task 1: Pure rules
- [ ] **Tests** in `test/unit/whats-new.test.ts`:
  - `AREAS` holds the seven views with their gates;
  - `reachableAreas(perms)` honours view and edit gates (fulfilments needs business-supporters edit);
  - `arrivalsSince({ seenAt, accountCreatedAt })` gives `seenAt` when there is one, and otherwise the
    later of the account's creation and `LAUNCH_AT`;
  - `featuresNew(area, { seenAt, accountCreatedAt }, FEATURES)` is true only for features added
    after the last visit (or, with none, after the account was created);
  - `isNew` combines arrivals and features.
- [ ] **Code:** implement `src/admin/whats-new.ts`.

### Task 2: Migration and SQL
- [ ] **Migration** `1791000000000_admin-seen.js`: `admin_seen(user_id int NOT NULL REFERENCES users ON
  DELETE CASCADE, area text NOT NULL, seen_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,
  area))`. Check it sorts last.
- [ ] **`src/db/whats-new.ts`:**
  - `getSeen(userId)` returns a map from area to Date;
  - `markSeen(userId, area)` upserts and returns the time recorded;
  - `getAccountCreatedAt(userId)`;
  - `latestArrival(area, since)` returns a Date or null. It runs one query per area:
    - contact and stories use their own pools;
    - donations counts paid ones;
    - monthly uses each donor's first paid monthly gift;
    - fulfilments uses the row's creation time;
    - ball uses the time a booking was paid;
    - newsletter counts footer sign-ups that are still subscribed.
- These are covered by BDD, since there is no local database.

### Task 3: Routes
- [ ] **Tests** in `test/unit/admin-whats-new-routes.test.ts`, with the db and authz mocked:
  - GET lists only the reachable areas, each with `new` and `since`;
  - a failing source gives `new: false` and the rest still answer;
  - POST gives 400 for an unknown area, 403 for one the person cannot reach, and 200 `{ area, seenAt }`.
- [ ] **Code:** implement the router and mount it in `src/app.ts`.

### Task 4: Browser
- [ ] **Tests** in `test/unit/admin-app.test.ts`, with `/api/admin/whats-new` stubbed:
  - pills appear on the menu sections flagged new, and on the Menu button;
  - opening one POSTs seen and removes its pill;
  - contact rows newer than `since` carry a New pill and older ones do not;
  - a failed whats-new request shows no pills and breaks nothing.
- [ ] **Code:**
  - `refreshWhatsNew()` runs after permissions load and on each `selectView`;
  - `markSeenOnOpen(name)`;
  - a `newPill(area, when)` helper, used in the seven row renderers;
  - CSS for `.admin-new-pill`.

### Task 5: BDD, README and ship
- [ ] **`features/whats-new.feature`:**
  1. Two admins.
  2. A POST to `/api/subscribe` from the footer.
  3. Both GETs show the newsletter as new.
  4. Admin A POSTs seen.
  5. A is no longer new, and B still is.
- [ ] **Push as a draft PR early** for the database and BDD verdict.
- [ ] **README section.** Also note for future work: "add a line to FEATURES when you ship a new
  screen".
- [ ] **Browser check** with the stand-in, then review, then ship.
