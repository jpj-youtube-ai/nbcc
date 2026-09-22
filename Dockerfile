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

# TASK-423: the nightly backup (`npm run backup`) needs pg_dump and 7z.
#
# pg_dump MUST be at least the server's major version. RDS runs Postgres 16; Debian bookworm ships
# postgresql-client 15, which REFUSES to dump a 16 server ("aborting because of server version
# mismatch"). So this comes from the PostgreSQL project's own apt repo rather than Debian's. If
# RDS is ever moved to 17 this breaks, and the backup-failure alert is what catches it — there is
# no way to notice locally, because locally there is no RDS.
#
# p7zip gives AES-256 with encrypted headers (-mhe=on). Chosen over a bespoke encrypted blob so
# that the charity can open a backup with 7-Zip and a password, on any Windows machine, without a
# developer and without this codebase. A backup only its authors can read is a weak backup.
#
# Placed before the npm install so it stays a cached layer that code changes do not invalidate.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg p7zip-full \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-16 \
 && apt-get purge -y --auto-remove gnupg curl \
 && rm -rf /var/lib/apt/lists/*

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
COPY index.html about.html donate.html contact.html supporters.html thank-you.html gift-aid.html portal.html privacy.html admin.html my-story.html hub.html set-password.html business-thank-you.html ball.html ball-terms.html 404.html sitemap.html _redirects ./
COPY assets ./assets
# TASK-332: stamp the commit into the image so the running service can say WHICH BUILD it is.
#
# Deliberately the LAST thing before the runtime declarations: an ARG that changes on every
# commit invalidates every layer below it, so it sits after all the COPYs to leave the build
# cache intact.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
