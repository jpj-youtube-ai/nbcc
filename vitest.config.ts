import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Vitest sets NODE_ENV=test by default, but the config schema (src/config/schema.ts)
    // only accepts development|staging|production — so any unit test that imports the config
    // module (e.g. via a client) would fail validation on load. Pin a valid value; all
    // NODE_ENV checks in src are `!== "production"`, so 'development' behaves as expected.
    env: { NODE_ENV: "development" },
  },
});
