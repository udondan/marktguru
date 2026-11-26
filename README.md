# marktguru-cli 🧘‍♂️

[![Test](https://github.com/udondan/marktguru-cli/actions/workflows/test.yml/badge.svg)](https://github.com/udondan/marktguru-cli/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/@udondan/marktguru-cli.svg)](https://www.npmjs.com/package/@udondan/marktguru-cli)
[![codecov](https://codecov.io/gh/udondan/marktguru-cli/graph/badge.svg)](https://codecov.io/gh/udondan/marktguru-cli)
[![Maintainability](https://qlty.sh/gh/udondan/projects/marktguru-cli/maintainability.svg)](https://qlty.sh/gh/udondan/projects/marktguru-cli)
[![license](https://img.shields.io/github/license/udondan/marktguru-cli.svg)](https://github.com/udondan/marktguru-cli/blob/main/LICENSE)

> [!NOTE]
> Unofficial community project. Not affiliated with, endorsed or authorized by marktguru.

CLI for Marktguru supermarket deals in Austria and Germany.

This is a maintained fork of [manmal/marktguru-cli](https://github.com/manmal/marktguru-cli), published as [`@udondan/marktguru-cli`](https://www.npmjs.com/package/@udondan/marktguru-cli).

## AI Agent Skill

Install into your coding agent with the [`skills`](https://skills.sh) CLI:

```bash
npx skills add udondan/marktguru-cli
```

Or read [skills/marktguru-grocery-deals/SKILL.md](skills/marktguru-grocery-deals/SKILL.md) directly — a comprehensive reference designed for AI coding agents.

## Quick Start (Recommended)

Use `npx` to run without installing anything:

```bash
npx --yes @udondan/marktguru-cli login
npx --yes @udondan/marktguru-cli search raw "milch OR soja"
npx --yes @udondan/marktguru-cli search build --term milch --or soja
```

## Requirements

- Node.js 18+ (built-in `fetch`)
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

## Disclaimer

This is an unofficial, independent open-source project and is not affiliated with marktguru Deutschland GmbH or its
affiliates. marktguru is a product or trademark of marktguru Deutschland GmbH or its affiliates. The name is used only
to describe compatibility. The API used is not public: the `login` command reads API keys from the marktguru website,
and both may change at any time. Use at your own risk and in accordance with the marktguru terms of use.
