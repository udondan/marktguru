import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { FullSearchResult } from '../api.js';
import { VALID_COUNTRIES } from '../config.js';
import { QUERY_SYNTAX_HELP } from '../query.js';
import {
  formatResultsText,
  performSearch,
  simplifyOffer,
  toJsonFull,
} from './search.js';

const INSTRUCTIONS = [
  'Searches current supermarket deals (offers from weekly leaflets) on',
  'Marktguru in Germany (de) and Austria (at). The API key is fetched',
  'automatically. Country and ZIP code default to the configuration',
  '(MARKTGURU_COUNTRY, MARKTGURU_ZIP, or ~/.marktguru/config.json) and can be',
  'set per search.',
  '',
  QUERY_SYNTAX_HELP,
].join('\n');

const FORMATS = {
  text: (result: FullSearchResult, query: string) =>
    formatResultsText(result, query),
  json: (result: FullSearchResult, query: string) =>
    JSON.stringify({
      query,
      total: result.totalResults,
      offers: result.results.map(simplifyOffer),
    }),
  'json-full': (result: FullSearchResult) => JSON.stringify(toJsonFull(result)),
};

const searchInput = {
  query: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Product to search, in German, with the Marktguru syntax: words, "exact phrase", OR, * as wildcard, ( ) for groups; AND and NOT are not supported. E.g. `milch`, `"erdnuss snips"`, `kellys OR manner`, `kell*`',
    ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Most offers to return. Default: 10'),
  zip: z
    .string()
    .regex(/^\d{4,5}$/)
    .optional()
    .describe(
      'ZIP code of the area whose stores count, 5 digits in Germany or 4 in Austria, e.g. `10115`. Default: the configured ZIP code, else 10115 in Germany and 1010 in Austria',
    ),
  country: z
    .enum(VALID_COUNTRIES)
    .optional()
    .describe(
      'Country: de (Germany) or at (Austria), matching the ZIP code. Default: the configured country, else de',
    ),
  retailer: z
    .string()
    .optional()
    .describe(
      'Only offers of retailers whose name contains this, ignoring case, e.g. `BILLA` or `rewe`. Searches up to 100 offers and filters them; `total` is then the number of offers of matching retailers',
    ),
  format: z
    .enum(['text', 'json', 'json-full'])
    .default('text')
    .describe(
      'text: readable list; json: compact offers; json-full: the complete API response',
    ),
};

type SearchInput = z.infer<z.ZodObject<typeof searchInput>>;

async function searchOffers({
  query,
  format,
  ...options
}: SearchInput): Promise<CallToolResult> {
  try {
    // jsonFull keeps the auto-login logs on stderr, off the protocol.
    const result = await performSearch(query, { ...options, jsonFull: true });
    return {
      content: [{ type: 'text', text: FORMATS[format](result, query) }],
    };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Error: ${(e as Error).message}` }],
    };
  }
}

export function createServer(version: string): McpServer {
  const server = new McpServer(
    { name: 'marktguru', version },
    { instructions: INSTRUCTIONS },
  );
  server.registerTool(
    'search_offers',
    {
      title: 'Search supermarket deals',
      description:
        'Searches the current supermarket deals (offers from weekly leaflets) on Marktguru in Germany or Austria. Returns the total number of matches and up to `limit` offers, each with title (brand, product, description), price in euros, retailer, the date the offer ends, the discount in percent against the old price where known, and a link. Only current offers are listed, no regular prices. Use it to find where a product is on sale, or to compare the deals of several retailers; one search per product, with OR for alternatives. Results depend on the location: `zip` and `country` default to the configuration, else Germany and 10115 (Berlin). Without a stored API key, the first search reads one from the Marktguru website and stores it in ~/.marktguru/config.json; nothing else is written.',
      inputSchema: searchInput,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    searchOffers,
  );
  return server;
}

// stdout carries the protocol, everything else goes to stderr.
export async function mcpCommand(version: string): Promise<void> {
  await createServer(version).connect(new StdioServerTransport());
}
