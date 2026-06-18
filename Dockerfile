# syntax=docker/dockerfile:1

# ---- build stage: install deps + compile the eve app ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
# deps first (better layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
# app source
COPY . .
# produce the Nitro production build under .output / .eve
RUN pnpm eve build

# ---- runtime stage: gh CLI + the built app ----
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# The agent's tools shell out to the GitHub CLI (`gh`), so it must be installed
# in the runtime image. `gh` authenticates from the GH_TOKEN env var at runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates git gnupg \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
# copy the installed + built app from the build stage
COPY --from=build /app /app
EXPOSE 3000
# Serve the built application in production mode.
CMD ["pnpm", "eve", "start", "--host", "0.0.0.0", "--port", "3000"]
