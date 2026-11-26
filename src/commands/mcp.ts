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
  'Marktguru in Austria (at) and Germany (de). The API key is fetched',
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
      'Marktguru query, e.g. `milch`, `"erdnuss snips"`, `kellys OR manner`',
    ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Number of offers (default: 10)'),
  zip: z
    .string()
    .regex(/^\d{4,5}$/)
    .optional()
    .describe('ZIP code for location-based results'),
  country: z
    .enum(VALID_COUNTRIES)
    .optional()
    .describe('Country: at (Austria) or de (Germany)'),
  retailer: z
    .string()
    .optional()
    .describe('Only offers of retailers whose name contains this, e.g. BILLA'),
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
        'Search current supermarket deals on Marktguru (AT/DE) with the Marktguru query syntax.',
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
