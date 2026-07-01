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
# Static marketing site served by the app (TASK-005 / REQ-033): the five pages,
# their shared assets, and the clean-URL rules. The site router resolves its root
# to /app (this WORKDIR) at runtime.
COPY index.html about.html donate.html contact.html supporters.html _redirects ./
COPY assets ./assets
EXPOSE 3000
USER node
CMD ["node", "dist/index.js"]
