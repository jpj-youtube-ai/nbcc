---
name: new-route
description: Use when adding a new HTTP route or endpoint to the nbcc Express service. Covers creating the router file, mounting it in src/app.ts, and adding a Cucumber feature scenario (and a Vitest unit test for any pure logic) so the change ships green with tests (golden rules 1 and 5).
---

# Add an HTTP route

## Overview

A route in nbcc is three things, and forgetting the test or the mount is the
usual miss: the **router file**, the **mount** in `src/app.ts`, and a **BDD
scenario** for the user-visible behaviour. Pure, DB-free logic also gets a
**Vitest unit test** (unit tests stay DB-free; HTTP behaviour is covered by BDD).

## Steps (create a todo per item)

1. **Router file** — `src/routes/<name>.ts` exporting a `Router`. Export a plain
   `Router` for a self-contained route, or a `create<Name>Router(...)` factory if
   it needs config/deps injected (keeps modules free of the config side effect,
   like `createHomeRouter`).
2. **Mount it** — import and `app.use(...)` in `src/app.ts`, under the
   "Add feature routers here." comment.
3. **BDD scenario** — add to an existing `features/*.feature` or a new one. The
   generic steps in `features/steps/health.steps.js` (`I GET {string}`, status,
   `response field`, `response body should contain`) already cover GET + JSON/HTML,
   so a new GET route usually needs **no new step code**.
4. **Unit test (if there's pure logic)** — `test/unit/<name>.test.ts` for any
   pure renderer/helper, exported separately from the router (see `renderHomePage`).
5. **Verify green** — `npm run lint && npm run build && npm run test:unit`, then
   BDD against a running app: `node dist/index.js &` then `npm run test:bdd`.

## Templates

**`src/routes/status.ts`** (self-contained JSON route):
```ts
import { Router } from "express";

export const statusRouter = Router();

statusRouter.get("/status", (_req, res) => {
  res.status(200).json({ service: "charity-site", status: "running" });
});
```

**Factory variant** (when the route needs injected config/deps):
```ts
import { Router } from "express";

export function createStatusRouter(env: string): Router {
  const router = Router();
  router.get("/status", (_req, res) => {
    res.status(200).json({ env, status: "running" });
  });
  return router;
}
```

**`src/app.ts`** (mount under the existing comment):
```ts
import { statusRouter } from "./routes/status";
// ...
  app.use(statusRouter);            // or app.use(createStatusRouter(config.NODE_ENV))
  // Add feature routers here.
```

**`features/status.feature`** (reuses existing steps — no new step file needed):
```gherkin
Feature: Status endpoint
  The service exposes a lightweight status endpoint.

  Scenario: status reports running
    When I GET "/status"
    Then the response status should be 200
    And the response field "status" should be "running"
```

## Common mistakes

- **No BDD scenario** — user-visible behaviour needs a `.feature` (golden rule 5).
- **DB work in a unit test** — keep units DB-free; exercise HTTP/DB paths via BDD.
- **Heavy work on `/health`** — it backs the ALB check and rollback trigger; keep
  it cheap (golden rule 6). Put non-trivial checks on a separate route.
- **Reading `process.env` in the route** — inject via a factory or read from the
  config module; never `process.env` directly (golden rule 3).
- **New step definitions when the generic ones fit** — reuse the steps in
  `features/steps/health.steps.js` before writing new ones.
