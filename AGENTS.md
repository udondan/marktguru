# AGENTS.md

Guidance for coding agents working in this repository.

## Commands

Node.js and Bun versions are pinned only in `mise.toml` (`mise install`); the
workflows install them with `jdx/mise-action`. Bun is the package manager
(`bun.lock`); Node runs the CLI and the tests, npm is only used for `npm pack`
and `npm publish` (trusted publishing).

The Make targets are exactly what CI runs (`.github/workflows/test.yml`), so
prefer them:

```bash
make install          # bun install --frozen-lockfile
make eslint           # lint
make lint-tools       # build, then lint the MCP tool descriptions (TDQS)
make format           # prettier --write .
make test             # build, then run the test suite under c8 (incl. live tests)
make test-unit        # same, offline tests only (what the Coverage workflow runs)
make validate-package # npm pack and assert the tarball contents
```

The `qlty` CI job runs the [qlty](https://qlty.sh) CLI directly; both must
report nothing:

```bash
qlty check --all      # plugins enabled in .qlty/qlty.toml (secrets, vulnerable dependencies, radarlint-js)
qlty smells --all     # complexity, nesting, duplication; PRs fail on new smells compared to main
```

Fix findings instead of silencing them. Only a deliberate finding (such as a
fake key in a test fixture) gets a `[[triage]]` entry in `.qlty/qlty.toml`,
scoped to the single rule and file, with a comment saying why.

The `markdown` CI job lints every Markdown file except `CHANGELOG.md` with
markdownlint-cli2; files and rules are in `.markdownlint-cli2.yaml`:

```bash
bunx markdownlint-cli2
```

Running the CLI locally:

```bash
bun run dev --help       # Bun runs the TypeScript directly
bun run start --help     # Node, from dist/, needs a build first
```

Single test file / single test case:

```bash
bun run build && node --test tests/query.test.ts
bun run build && node --test --test-name-pattern "<name>" tests/query.test.ts
```

## Architecture

ESM throughout (`"type": "module"`), TypeScript compiled to `dist/` with
`NodeNext` resolution — relative imports must carry the `.js` extension.

`src/cli.ts` is the `bin` target and only calls `run()` from `src/program.ts`,
which builds the Commander program (`createProgram()`). Commands delegate to a
module in `src/commands/`, which calls `ensureApiKey` (reads `src/config.ts`,
falls through to `src/auth.ts` when no key is stored), then `search()` in
`src/api.ts`, then renders through `formatResultsText` or `simplifyOffer` in
`src/commands/search.ts`. `src/query.ts` is pure and I/O-free.

`src/commands/serve.ts` (`marktguru serve`) is a read-only HTTP API on
`node:http`. `GET /search` calls the same `performSearch()` and `toJsonFull()`
as `search raw --json-full`, so the CLI and the API return identical data.

`src/commands/mcp.ts` (`marktguru mcp`) is an MCP server on stdio
(`@modelcontextprotocol/sdk`, schemas in `zod`). Its one tool,
`search_offers`, also calls `performSearch()` and renders with the same
functions as the CLI. stdout carries the protocol, so nothing in the search
path may write to it (`performSearch` gets `jsonFull: true`, which keeps the
auto-login logs on stderr).

Results go to stdout; `--explain` and every warning go to stderr, so `--json`
output stays pipeable.

## Constraints

These are the things that are easy to break without noticing.

- **Tests run against `dist/`.** `tests/*.test.ts` import `../dist/*.js`, so a
  stale build silently tests old code. `bun run test` runs `bun run build` first for
  exactly this reason — never invoke bare `node --test`. Node runs the test
  files by stripping their types, so they may only use erasable syntax (no
  enums, namespaces or parameter properties); `tsconfig-tests.json` enforces
  that and is type-checked by `bun run test` against the declarations in `dist/`.
- **Coverage must stay at 100 %.** `bun run test` and `bun run test:unit` run under
  c8 (`.c8rc.json`), which fails below 100 % lines, branches, functions or
  statements and writes `coverage/lcov.info`, mapped back to `src/*.ts` through
  source maps. The offline tests alone must reach 100 %: the Coverage workflow
  uploads `make test-unit` results from `main`, and Codecov requires 100 % patch
  coverage on pull requests. Tests mock `fetch` instead of touching the network,
  set `HOME` to a temp dir before importing `dist/` (see `tests/helpers.ts`),
  and `tests/cli.test.ts` spawns `dist/cli.js`, whose coverage c8 collects as
  well. Remove unreachable branches instead of adding `c8 ignore` comments.
- **release-please owns the version.** `src/program.ts` carries
  `.version('0.1.0') // x-release-please-version`; the trailing comment is
  load-bearing and matches `extra-files` in `release-please-config.json`. Never
  hand-edit the version in `package.json`, `src/program.ts`, or
  `.release-please-manifest.json`.
- **Country validation is a security guard.** The country code is interpolated
  into a hostname, so `getApiBase()` and `extractApiKey()` hard-validate against
  `VALID_COUNTRIES` before building a URL. Do not relax this. Only `at` and `de`
  exist.
- **API keys are country-scoped.** `set-country` deliberately clears `apiKey`
  when the country actually changes, and `search` auto-logs-in using the
  configured country.
- **A config file without a country is Austrian.** The default country is
  `de`, but versions up to 1.1 defaulted to `at` and stored the country only
  on `set-country`. `fallbackCountry()` in `src/config.ts` therefore reads a
  non-empty file without `country` as `at` (so its stored key keeps working),
  and `saveConfig()` always writes the country. The default ZIP code follows
  the country (`defaultZipCode()`).
- **`login` is scraping, not an account login.** It fetches the public site,
  regex-scans the HTML and boot scripts for an embedded key, and brute-force
  validates candidates against the live search endpoint. It breaks whenever
  Marktguru ships a new frontend bundle, which the offline tests in
  `tests/auth.test.ts` (mocked pages) cannot notice. `tests/live.test.ts` runs
  the built CLI end to end against the live sites for both countries (isolated
  `HOME`), so `make test` needs network access and fails when the scraper
  breaks. `make test-unit` skips the live tests by their `live:` name prefix.
- **The key is stored in plaintext** at `~/.marktguru/config.json`. The `config`
  and `login` output truncates it — preserve that.
- **The stored key belongs to the config file's country.** `getConfig()`
  applies `MARKTGURU_COUNTRY` / `MARKTGURU_ZIP` on top of the file,
  `getFileConfig()` doesn't, and `saveConfig()` never persists the
  environment. `ensureApiKey` uses the stored key only for the file's
  country; other countries (environment or a per-call `country`) log in and
  keep the key in memory, dropped again when a search with it fails.
- **`--retailer` filters client-side** on `advertisers[].name`, which is why
  `runSearch` over-fetches 100 results and rewrites `totalResults` to the
  post-filter count.
- **Two different default limits:** 10 in `src/commands/search.ts`, 20 in the
  `search()` fallback in `src/api.ts`.
- **ESLint covers `src/` and `tests/`** via the `tsconfig-lint.json` and
  `tsconfig-tests.json` projects. Linting the tests needs `dist/*.d.ts`, so
  `make eslint` builds first. A new `.ts` file anywhere else makes type-aware
  linting fail.
- **Exact dependency versions only** — no `^` or `~`.
- **`make validate-package` asserts a hardcoded file list.** Extend it when a
  new module is added under `src/`. Source maps are built for coverage but excluded from the
  package via `!dist/**/*.map` in `files`.

- **`serve` is deliberately read-only.** No endpoint returns the API key or
  changes the config. It binds to `127.0.0.1` by default; any other host needs
  a bearer token, and on loopback binds the `Host` header must be a loopback
  name (DNS rebinding). Requests with a foreign `Origin` are rejected and no
  CORS headers are sent. Keep it that way when adding endpoints.

## Docker

`Dockerfile` copies the prebuilt `dist/` (`make docker-build` builds it
first) and installs the runtime dependencies with Bun from `bun.lock`; keep
its `oven/bun` tag on the Bun version of `mise.toml`. Without arguments the
image runs `mcp`. `docker-mcp.yml` is the server definition for the Docker MCP
Toolkit, `make docker-register [PROFILE=<id>]` adds it to a profile. The
`docker` CI job builds the image and lists its tools through the gateway;
`publish.yml` pushes `udondan/marktguru` multi-arch to Docker Hub on release
(environment `docker-hub`, secret `DOCKERHUB_TOKEN`, variable
`DOCKERHUB_USERNAME`) and signs it keyless with cosign.

## Release flow

PRs are squash-merged, so the **PR title must be a Conventional Commit** — it
becomes the changelog entry, and `pr-conventional-title.yml` enforces it.
Renovate forces `chore:` for dependency bumps and does not automerge majors.
release-please opens a release PR on every push to `main`; a Monday 09:00 UTC
cron automerges the single PR labeled `autorelease: pending`, so releases go out
weekly rather than per merge. The resulting `v*` tag triggers
`npm publish --provenance` via npm trusted publishing (no `NPM_TOKEN`).

## CI

Every job in `test.yml` except `required` waits for boarding-gate (job `Queue`,
one run at a time because the live tests hit Marktguru) and fails if it failed:
while another run holds the turn, the branch likely needs a rebase anyway, so
nothing runs in parallel. On pull requests the `changes` job
(`dorny/paths-filter`) decides whether the `test` job runs; when the code or the
build starts depending on another file, add it to that filter, or the tests
silently skip. `actions` (actionlint, zizmor), `markdown` and `qlty` always
run.

## Keep in sync

`skills/marktguru-grocery-deals/SKILL.md` documents _using_ the CLI for agents
that consume it; `README.md` documents the same surface for humans. Changing a
command or flag means updating both. The directory name has to match the
skill's frontmatter `name`, and the `skills/<name>/SKILL.md` layout is what the
`skills` CLI discovers and installs.
