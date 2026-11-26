---
name: marktguru-grocery-deals
description: Look up grocery deals and offers via the marktguru CLI, HTTP API or MCP server. Use when user asks about supermarket discounts, product prices, current promotions, or comparing deals across Austrian or German retailers (Hofer, Billa, Spar, Lidl, Penny, REWE, Kaufland, etc.).
---

# Marktguru Grocery Deals

Query grocery deals from Marktguru in Austria and Germany. Supports raw queries, structured search building, retailer filtering, ZIP-code location targeting, and country selection (AT/DE).

## Quick Reference

| Command              | Purpose                                           |
| -------------------- | ------------------------------------------------- |
| `search raw <query>` | Search with raw query string                      |
| `search build`       | Build query from structured flags                 |
| `search syntax`      | Show supported query syntax                       |
| `set-zip <code>`     | Set default ZIP code                              |
| `set-country <code>` | Set default country (`at` or `de`, default: `at`) |
| `config`             | Show current configuration                        |
| `login`              | Extract API key from marktguru.at/de              |
| `serve`              | Run a local, read-only HTTP API                   |
| `mcp`                | Run an MCP server on stdio                        |

---

## Setup

### Login (HTTP scan)

```bash
npx @udondan/marktguru login
```

Scans site HTML and boot scripts for embedded API keys. No browser automation required.

### Set Default ZIP Code

```bash
npx @udondan/marktguru set-zip 1010
npx @udondan/marktguru set-zip 8010  # Graz
npx @udondan/marktguru set-zip 10115  # Berlin (DE)
```

### Set Default Country

```bash
npx @udondan/marktguru set-country at  # Austria (default)
npx @udondan/marktguru set-country de  # Germany
```

After switching country, re-run `login` — API keys are country-specific.

### Check Config

```bash
npx @udondan/marktguru config
npx @udondan/marktguru config --json
```

---

## Search Commands

### Raw Query Search

```bash
npx @udondan/marktguru search raw "Milch"
npx @udondan/marktguru search raw "Milch" --limit 5
npx @udondan/marktguru search raw "Bier" --retailer HOFER
npx @udondan/marktguru search raw "Brot" --zip 8010
npx @udondan/marktguru search raw "Cola" --json
```

### Common Options

| Flag                       | Description                                   | Default        |
| -------------------------- | --------------------------------------------- | -------------- |
| `--limit <n>` / `-n`       | Number of results                             | 10             |
| `--retailer <name>` / `-r` | Filter by retailer (e.g., SPAR, BILLA, HOFER) | all            |
| `--zip <code>` / `-z`      | ZIP code for location-based results           | config default |
| `--json` / `-j`            | Output JSON                                   | false          |
| `--json-full`              | Output the complete API response as JSON      | false          |

### Structured Builder

Build queries from flags instead of raw strings:

```bash
npx @udondan/marktguru search build --term butter --explain
npx @udondan/marktguru search build --or butter --or margarine --explain
npx @udondan/marktguru search build --phrase "frische milch" --limit 5
npx @udondan/marktguru search build --wildcard "jogh*" --retailer SPAR
```

| Flag                 | Description                                |
| -------------------- | ------------------------------------------ |
| `--term <value>`     | Add a search term                          |
| `--phrase <value>`   | Add exact phrase (quoted)                  |
| `--wildcard <value>` | Add wildcard term (e.g., `kell*`)          |
| `--or <value>`       | Add term to OR group (repeat for multiple) |
| `--group <value>`    | Add raw parenthesized group                |
| `--explain`          | Print the built query to stderr            |

---

## Query Syntax

**Supported:**

- `OR` — boolean OR: `Milch OR Sahne`
- `*` — wildcard: `Jogh*` (matches Joghurt, Joghurtdrink, etc.)
- `"..."` — exact phrase: `"frische Milch"`
- `()` — grouping: `(Milch OR Sahne) Bio`

**NOT supported:** `AND`, `NOT`, `~`, `^`

### Examples

```bash
# Simple term
npx @udondan/marktguru search raw "Butter"

# OR logic
npx @udondan/marktguru search raw "Käse OR Schinken"

# Wildcard
npx @udondan/marktguru search raw "Bio*"

# Combined with retailer filter
npx @udondan/marktguru search raw "Bier" --retailer HOFER --limit 10

# Exact phrase
npx @udondan/marktguru search raw '"Coca Cola"'
```

---

## Known Retailers

| Retailer              | AT  | DE  | Notes                       |
| --------------------- | --- | --- | --------------------------- |
| Lidl                  | ✓   | ✓   |                             |
| PENNY                 | ✓   | ✓   |                             |
| dm drogerie markt     | ✓   | ✓   | Drugstore (some food items) |
| SPAR                  | ✓   |     |                             |
| INTERSPAR             | ✓   |     | Larger SPAR format          |
| SPAR-Gourmet          | ✓   |     | Premium SPAR                |
| BILLA                 | ✓   |     |                             |
| BILLA PLUS            | ✓   |     | Larger BILLA format         |
| HOFER                 | ✓   |     | Austrian Aldi               |
| BIPA                  | ✓   |     | Drugstore                   |
| Kaufland              |     | ✓   |                             |
| REWE                  |     | ✓   |                             |
| Netto Marken-Discount |     | ✓   |                             |
| ALDI                  |     | ✓   |                             |

---

## JSON Output

```bash
npx @udondan/marktguru search raw "Cola" --limit 3 --json
```

```json
{
  "query": "Cola",
  "total": 23,
  "offers": [
    {
      "title": "Coca-Cola - Cola - oder Fanta 1,5l",
      "price": 1.49,
      "retailer": "Sizin Foods GmbH",
      "expires": "2026-02-11",
      "discountPercent": null
    },
    {
      "title": "Coca-Cola - Cola - Zero / Fanta / Sprite Dose 330ml",
      "price": 0.6,
      "retailer": "Sizin Foods GmbH",
      "expires": "2026-02-11",
      "discountPercent": null
    },
    {
      "title": "Coca-Cola - Cola - div. Sorten 0,33 Liter",
      "price": 0.67,
      "retailer": "BILLA",
      "expires": "2026-02-11",
      "discountPercent": 50,
      "externalUrl": "https://shop.billa.at/produkte/..."
    }
  ]
}
```

| Field             | Description                               |
| ----------------- | ----------------------------------------- |
| `title`           | Product name and brand                    |
| `price`           | Current offer price (EUR)                 |
| `retailer`        | Store name                                |
| `expires`         | Offer expiration date (YYYY-MM-DD)        |
| `discountPercent` | Discount percentage (null if not on sale) |
| `externalUrl`     | Direct link to retailer (optional)        |

### Full JSON Output

`--json-full` prints the complete API response instead, for fields `--json`
drops (images, categories, all advertisers, raw validity dates) and the
`filters` facets. `--retailer` and `--limit` still apply, and `totalResults`
is the count after the retailer filter. It takes precedence over `--json`.

```bash
npx @udondan/marktguru search raw "Cola" --limit 3 --json-full
```

```json
{
  "query": "Cola",
  "totalResults": 23,
  "results": [
    {
      "id": 12345,
      "price": 0.67,
      "oldPrice": 1.35,
      "product": { "id": 678, "name": "Cola" },
      "brand": { "name": "Coca-Cola" },
      "advertisers": [{ "name": "BILLA" }],
      "validityDates": [{ "from": "...", "to": "..." }],
      "descriptionLines": [
        "Cola [Coca-Cola]",
        "€0.67 (was €1.35) -50%",
        "div. Sorten 0,33 Liter",
        "BILLA · 3 days left",
        "https://shop.billa.at/produkte/..."
      ]
    }
  ],
  "filters": { "retailers": [], "brands": [], "categories": [] }
}
```

The offer objects are passed through from the Marktguru API (shortened above),
so their fields follow the upstream API and may change. `descriptionLines` is
added by the CLI: the lines the text output prints for the offer, without
icons. Use it to show an offer to a person; its wording may change, so read
data from the structured fields.

---

## HTTP API

`serve` runs a local HTTP server for tools that prefer HTTP over spawning the
CLI. `GET /search` takes `q` (required), `limit`, `zip` and `retailer` and
returns the same JSON as `--json-full`; `GET /health` returns
`{"success": true}`.

```bash
npx @udondan/marktguru serve --port 3000
curl 'http://127.0.0.1:3000/search?q=Milch&limit=5'
```

It is read-only (no login, no config changes, never returns the API key) and
listens on `127.0.0.1` by default. Any other `--host` requires a token via
`--token` or `MARKTGURU_SERVE_TOKEN`, sent as `Authorization: Bearer <token>`.
Requests with a foreign `Origin`, or a non-loopback `Host` on a loopback bind,
get 403. Errors use `{"success": false, "error": "..."}`.

---

## MCP Server

`mcp` runs an MCP server on stdio with one read-only tool, `search_offers`:
`query` (required), `limit`, `zip`, `country` (`at`, `de`), `retailer` and
`format` (`text` default, `json` like `--json`, `json-full` like
`--json-full`). It logs in automatically on the first search.

```bash
claude mcp add marktguru -- npx -y @udondan/marktguru mcp
```

The Docker image `udondan/marktguru` starts the same server without
arguments (`docker run --rm -i udondan/marktguru`); arguments after the image
name run the CLI instead.

---

## Human-Readable Output

```text
Found 147 offers for "Milch":

Premium Bergbauern H-Milch [Salzburg Milch]
  💰 €0.99 (was €1.59) -38% · €0.99/l
  📦 3,5% Fett oder 0,5% Fett aus Österreich, 1 Liter
  🏪 SPAR · 20 days left

📍 Retailers: Lidl (33), SPAR (30), PENNY (17), INTERSPAR (16), BILLA PLUS (11)
```

---

## Config

Credentials and settings stored at `~/.marktguru/config.json`.

```bash
npx @udondan/marktguru config --json
```

```json
{
  "apiKey": "pCcm1AVCYa...",
  "apiKeySet": true,
  "zipCode": "1010",
  "country": "at",
  "configPath": "/Users/.../.marktguru/config.json"
}
```

`MARKTGURU_COUNTRY` and `MARKTGURU_ZIP` override country and ZIP code without
saving them, e.g. in Docker. The stored key belongs to the country in the
config file; a search in another country fetches its own key and keeps it in
memory only.

---

## Troubleshooting

| Issue                 | Solution                                                                        |
| --------------------- | ------------------------------------------------------------------------------- |
| Login fails           | Site structure may have changed. Re-run `login` or check for CLI updates.       |
| No results            | Try broader terms, wildcards (`*`), or alternative spellings.                   |
| Wrong location        | Set ZIP code with `set-zip` or use `--zip` flag.                                |
| API key expired       | Re-run `npx @udondan/marktguru login` to refresh.                               |
| Wrong country results | Run `set-country de` (or `at`), then `login` again — keys are country-specific. |

---

## Usage Tips

1. **Compare prices:** Use `--json` output to programmatically compare across retailers
2. **Find best deals:** Look for high `discountPercent` values
3. **Check availability:** Use `--zip` with local ZIP code for accurate results
4. **Wildcards for variants:** Use `Jogh*` to catch Joghurt, Joghurtdrink, etc.
5. **OR for alternatives:** `Butter OR Margarine` to compare substitutes
