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
# Demo-data seed (scripts/seed-demo.mjs), run as a one-off ECS task against a
# non-prod DB to populate the admin dashboard. Never invoked by CMD; it self-guards
# against NODE_ENV=production. Uses `pg` (a runtime dependency).
COPY scripts/seed-demo.mjs ./scripts/seed-demo.mjs
# Static marketing site served by the app (TASK-005 / REQ-033): every served page,
# their shared assets, and the clean-URL rules. The site router resolves its root
# to /app (this WORKDIR) at runtime. Every .html the app serves must be here — the
# clean-URL pages (thank-you.html backs /donate/thank-you) AND gift-aid.html (the
# declaration-form template read by src/routes/api.ts). test/unit/dockerfile-site-assets
# guards this list against the served files so a new page can't ship a route with no file.
COPY index.html about.html donate.html contact.html supporters.html thank-you.html gift-aid.html portal.html privacy.html admin.html _redirects ./
COPY assets ./assets
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
