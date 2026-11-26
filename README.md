# marktguru 🧘‍♂️

[![npm](https://img.shields.io/npm/v/@udondan/marktguru)](https://www.npmjs.com/package/@udondan/marktguru)
[![Docker](https://img.shields.io/docker/v/udondan/marktguru?sort=semver&label=docker)](https://hub.docker.com/r/udondan/marktguru)
[![Node.js](https://img.shields.io/node/v/@udondan/marktguru)](https://www.npmjs.com/package/@udondan/marktguru)
[![Test](https://github.com/udondan/marktguru/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/udondan/marktguru/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/udondan/marktguru/graph/badge.svg)](https://codecov.io/gh/udondan/marktguru)
[![Maintainability](https://qlty.sh/gh/udondan/projects/marktguru/maintainability.svg)](https://qlty.sh/gh/udondan/projects/marktguru)
[![License](https://img.shields.io/github/license/udondan/marktguru)](LICENSE)

> [!NOTE]
> Unofficial community project. Not affiliated with, endorsed or authorized by marktguru.

Marktguru supermarket deals in Austria and Germany, as a CLI, a local HTTP
API and an MCP server.

This is a maintained fork of [manmal/marktguru-cli](https://github.com/manmal/marktguru-cli), published as [`@udondan/marktguru`](https://www.npmjs.com/package/@udondan/marktguru)
(formerly [`@udondan/marktguru-cli`](https://www.npmjs.com/package/@udondan/marktguru-cli)).

## AI Agent Skill

Install into your coding agent with the [`skills`](https://skills.sh) CLI:

```bash
npx skills add udondan/marktguru
```

Or read [skills/marktguru-grocery-deals/SKILL.md](skills/marktguru-grocery-deals/SKILL.md) directly — a comprehensive reference designed for AI coding agents.

## Quick Start (Recommended)

Use `npx` to run without installing anything:

```bash
npx --yes @udondan/marktguru login
npx --yes @udondan/marktguru search raw "milch OR soja"
npx --yes @udondan/marktguru search build --term milch --or soja
```

## Requirements

- Node.js 22.12+
- Works with `npm`, `pnpm`, and `bun`

## Commands

Login (extracts API key via HTTP by scanning the site’s JS):

```bash
marktguru login
```

Search (raw query string syntax):

```bash
marktguru search raw "kellys OR \"erdnuss snips\""
```

Search (structured builder):

```bash
marktguru search build --term kellys --phrase "erdnuss snips" --or manner --explain
```

Show supported query syntax:

```bash
marktguru search syntax
```

Set a default ZIP code:

```bash
marktguru set-zip 1010
```

Set a default country (`at` or `de`, default: `at`):

```bash
marktguru set-country de
```

Show config:

```bash
marktguru config
```

Run a local, read-only HTTP API (see [HTTP API](#http-api)):

```bash
marktguru serve
```

## Also Working (Install Locally)

Install and run from source:

```bash
mise install   # Node.js and Bun, versions from mise.toml
bun install --frozen-lockfile
bun run build
bun run start --help
```

Dev mode (TS directly, run by Bun):

```bash
bun run dev --help
```

Lint, format and test (same targets CI runs):

```bash
make eslint
make format
make test
make validate-package
```

## Search Options

Available for both `search raw` and `search build`:

- `-z, --zip <code>`: ZIP code for location-based results
- `-n, --limit <number>`: Number of results (default: 10)
- `-r, --retailer <name>`: Filter by retailer (client-side)
- `-j, --json`: JSON output, reduced to a few fields per offer
- `--json-full`: The complete API response as JSON (`query`, `totalResults`,
  `results` with every offer field, `filters`). The retailer filter and limit
  still apply. The shape follows the upstream Marktguru API and may change
  when it does. Each offer also gets `descriptionLines`, the lines the text
  output prints for it without icons; they are meant for display and their
  wording may change. Takes precedence over `--json`.

If no API key is configured, `search` will automatically run `login` to extract one.

Note: API keys are country-specific. After switching country with `set-country`, run `login` again to fetch the matching key.

Builder-only:

- `--term <value>`: Add a term (repeatable)
- `--phrase <value>`: Add an exact phrase (repeatable)
- `--wildcard <value>`: Add a wildcard term like `kell*` (repeatable)
- `--or <value>`: Add a term to an OR group (repeatable)
- `--group <value>`: Add a raw group wrapped in parentheses (repeatable)
- `--explain`: Print the built query to stderr

## HTTP API

`marktguru serve` runs a small HTTP server so tools like Home Assistant,
n8n, Node-RED or a dashboard can query deals without spawning the CLI.

```bash
marktguru serve                    # http://127.0.0.1:3000
marktguru serve --port 0           # pick a free port, printed to stderr
MARKTGURU_SERVE_TOKEN=secret marktguru serve --host 0.0.0.0
```

| Endpoint      | Parameters                                 | Response                              |
| ------------- | ------------------------------------------ | ------------------------------------- |
| `GET /search` | `q` (required), `limit`, `zip`, `retailer` | Same JSON as `search raw --json-full` |
| `GET /health` |                                            | `{"success": true}`                   |

```bash
curl 'http://127.0.0.1:3000/search?q=milch&limit=5&retailer=billa'
```

Errors use `{"success": false, "error": "..."}` with status 400 (bad
parameters), 401 (missing or wrong token), 403 (foreign `Host` or `Origin`),
404, 405 or 502 (Marktguru API or login failed). Searches use the configured
country and log in automatically when no key is stored.

For AI assistants, see [MCP Server](#mcp-server).

Security model:

- Read-only: no endpoint returns the API key or changes the config. Use the
  CLI for `login`, `set-zip` and `set-country`.
- Listens on `127.0.0.1` by default. Any other `--host` requires a token
  (`--token` or `MARKTGURU_SERVE_TOKEN`), sent as `Authorization: Bearer <token>`.
- On loopback, requests whose `Host` isn't `127.0.0.1`, `localhost` or
  `[::1]` with the server's port are rejected, against DNS rebinding.
- Requests with an `Origin` other than the server's own are rejected, and no
  CORS headers are sent, so web pages open in your browser can't use it.
- Stops cleanly on Ctrl+C (`SIGINT`) and `SIGTERM`.

## MCP Server

`marktguru mcp` runs an [MCP](https://modelcontextprotocol.io) server on
stdio, so AI assistants can search deals directly. It has one read-only tool:

| Tool            | Arguments                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `search_offers` | `query` (required), `limit`, `zip`, `country` (`at`, `de`), `retailer`, `format` (`text`, `json`, `json-full`) |

`format` picks the same output as the CLI: the readable list (default),
`--json` or `--json-full`. The API key is fetched automatically on the first
search, like `search` does. Country and ZIP code default to the
[config](#config-location) and can be set per search.

### Claude Code

```bash
claude mcp add marktguru -- npx -y @udondan/marktguru mcp
```

### Claude Desktop and other clients

Add to the client's MCP configuration (for Claude Desktop
`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "marktguru": {
      "command": "npx",
      "args": ["-y", "@udondan/marktguru", "mcp"],
      "env": { "MARKTGURU_COUNTRY": "de", "MARKTGURU_ZIP": "10115" }
    }
  }
}
```

`env` is optional, see [Config Location](#config-location).

## Docker

The image [`udondan/marktguru`](https://hub.docker.com/r/udondan/marktguru)
starts the MCP server without arguments. Arguments after the image name are
passed to the CLI:

```bash
docker run --rm -i udondan/marktguru                       # MCP server on stdio
docker run --rm -e MARKTGURU_COUNTRY=de -e MARKTGURU_ZIP=10115 udondan/marktguru search raw milch
```

`~/.marktguru/config.json` is not visible inside the container, so set
country and ZIP code with `MARKTGURU_COUNTRY` and `MARKTGURU_ZIP`. The API key
is fetched once per container.

The images are signed with [cosign](https://github.com/sigstore/cosign)
(keyless, by the release workflow of this repository):

```bash
cosign verify udondan/marktguru:latest \
  --certificate-identity-regexp '^https://github.com/udondan/marktguru/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

### Docker MCP Toolkit

With the [Docker MCP Toolkit](https://docs.docker.com/ai/mcp-catalog-and-toolkit/toolkit/)
of Docker Desktop, the server runs as a container behind the MCP Gateway,
which starts it on demand and passes its tools on to the connected clients.

1. Download the server definition [`docker-mcp.yml`](docker-mcp.yml) and add it
   to a Toolkit profile. The Toolkit only reads such files from its catalogs
   directory:

   ```bash
   mkdir -p ~/.docker/mcp/catalogs
   curl -fsSL https://raw.githubusercontent.com/udondan/marktguru/main/docker-mcp.yml -o ~/.docker/mcp/catalogs/marktguru.yml

   # new profile "marktguru" ...
   docker mcp profile create --name marktguru --id marktguru --server "file://$HOME/.docker/mcp/catalogs/marktguru.yml"
   # ... or add it to an existing profile
   docker mcp profile server add default --server "file://$HOME/.docker/mcp/catalogs/marktguru.yml"
   ```

   The profile keeps the image at the version it had when it was added. Run
   `profile server add` again to update. From a clone of this repository,
   `make docker` builds the image locally and does the same
   (`make docker-register PROFILE=<id>` for another profile).

2. Optionally set the default country and ZIP code (Austria and 1010
   otherwise):

   ```bash
   docker mcp profile config marktguru --set marktguru.country=de --set marktguru.zip=10115
   ```

3. Connect a client to the profile:

   ```bash
   docker mcp client connect claude-desktop --profile marktguru
   ```

   `docker mcp client connect --help` lists more clients such as `claude-code`,
   `cursor` or `vscode`.

`docker mcp gateway run --profile marktguru --dry-run --verbose` checks the
setup without starting a client. The output should end with
`marktguru: (1 tools)`.

## Query Syntax (Observed)

The API appears to accept a Lucene/Elasticsearch-style query string, not SQL.

Supported:

- `OR` for boolean OR
- `*` wildcard (e.g., `kell*`)
- `"..."` exact phrase
- `( ... )` grouping

Not supported (observed):

- `AND`, `NOT`, `~`, `^`

## Notes on `login`

- Uses HTTP requests (no browser automation).
- Scans entry HTML and boot scripts for embedded API keys and validates them.
- May break if the website changes.

## Config Location

- `~/.marktguru/config.json`

The environment variables `MARKTGURU_COUNTRY` (`at`, `de`) and `MARKTGURU_ZIP`
override the country and default ZIP code of the config file for `search`,
`serve` and `mcp`. They are not saved. The stored API key belongs to the
country in the config file; searches in another country fetch a key for it
and keep it in memory only.

## Disclaimer

This is an unofficial, independent open-source project and is not affiliated with marktguru Deutschland GmbH or its
affiliates. marktguru is a product or trademark of marktguru Deutschland GmbH or its affiliates. The name is used only
to describe compatibility. The API used is not public: the `login` command reads API keys from the marktguru website,
and both may change at any time. Use at your own risk and in accordance with the marktguru terms of use.
