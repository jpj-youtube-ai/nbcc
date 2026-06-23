import { Router } from "express";

// Placeholder charity name - swap for the real one when it's known.
export const CHARITY_NAME = "Charity Site";

// Pure, DB-free renderer so the markup can be unit-tested without HTTP or
// loading the config module (which exits the process on missing env).
export function renderHomePage(env: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${CHARITY_NAME}</title>
  </head>
  <body>
    <h1>${CHARITY_NAME}</h1>
    <p>Supporting our community, one step at a time.</p>
    <p>Environment: ${env}</p>
  </body>
</html>
`;
}

// Static landing page for eyeballing a deploy in a browser. No DB, kept cheap.
// `env` is injected by the caller so this module stays free of the config
// side effect, keeping the unit test for renderHomePage config-free.
export function createHomeRouter(env: string): Router {
  const router = Router();
  router.get("/", (_req, res) => {
    res.type("html").send(renderHomePage(env));
  });
  return router;
}
