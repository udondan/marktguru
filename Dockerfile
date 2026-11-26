# Expects a compiled dist/ next to it: `make docker-build` builds it first.
# TypeScript and the rest of the dev tooling stay out of the Docker build.

# Runtime dependencies exactly as locked. Same Bun version as in mise.toml.
FROM oven/bun:1.4.5-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts


FROM node:26-alpine

LABEL com.docker.desktop.mcp="true"
LABEL com.docker.desktop.mcp.name="marktguru"

WORKDIR /app
COPY package.json ./
COPY --from=deps /app/node_modules node_modules/
COPY dist/ dist/

# npm and corepack aren't needed at runtime, and their bundled dependencies
# show up in vulnerability scans. apk upgrade pulls fixes for Alpine packages
# released after the base image.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
       /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
       /root/.npm

# The API key is fetched on the first search and kept in
# /home/node/.marktguru for the lifetime of the container.
USER node

# `docker run udondan/marktguru <command>` runs the CLI; without a command the
# image starts the MCP server, which is what the Docker MCP Toolkit expects.
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["mcp"]
