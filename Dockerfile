# ---- build ----
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
# Stories DB migrations (My Story / TASK-B2): a SEPARATE `stories` database on the same
# RDS instance, migrated via `npm run migrate:stories` (-m migrations-stories) as a one-off
# ECS task in the staging deploy. Its own directory must ship in the image or the step fails
# with MODULE_NOT_FOUND at deploy time (guarded by test/unit/dockerfile-scripts-shipped).
COPY migrations-stories ./migrations-stories
# Demo-data seed (scripts/seed-demo.mjs), run as a one-off ECS task against a
# non-prod DB to populate the admin dashboard. Never invoked by CMD; it self-guards
# against NODE_ENV=production. Uses `pg` (a runtime dependency).
COPY scripts/seed-demo.mjs ./scripts/seed-demo.mjs
# Stories DB bootstrap (scripts/bootstrap-stories-db.mjs, My Story / TASK-B2): a one-off ECS
# task (`npm run bootstrap:stories`) that provisions the separate `stories` database + role
# before migrate:stories. Must ship in the image or the deploy step fails with MODULE_NOT_FOUND.
COPY scripts/bootstrap-stories-db.mjs ./scripts/bootstrap-stories-db.mjs
# Contact inbox (2026-07-10 spec): a SEPARATE `contact` database on the same RDS instance,
# migrated via `npm run migrate:contact` (-m migrations-contact) and provisioned by
# `npm run bootstrap:contact` (scripts/bootstrap-contact-db.mjs) as one-off ECS tasks. Both must
# ship in the image or the deploy step fails with MODULE_NOT_FOUND (as the stories bootstrap did).
COPY migrations-contact ./migrations-contact
COPY scripts/bootstrap-contact-db.mjs ./scripts/bootstrap-contact-db.mjs
# Static marketing site served by the app (TASK-005 / REQ-033): every served page,
# their shared assets, and the clean-URL rules. The site router resolves its root
# to /app (this WORKDIR) at runtime. Every .html the app serves must be here — the
# clean-URL pages (thank-you.html backs /donate/thank-you) AND gift-aid.html (the
# declaration-form template read by src/routes/api.ts). test/unit/dockerfile-site-assets
# guards this list against the served files so a new page can't ship a route with no file.
COPY index.html about.html donate.html contact.html supporters.html thank-you.html gift-aid.html portal.html privacy.html admin.html my-story.html hub.html _redirects ./
COPY assets ./assets
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
