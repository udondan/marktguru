import {
  search as apiSearch,
  formatPrice,
  formatDiscount,
  formatValidity,
  type FullSearchResult,
  type Offer,
  type SearchResult,
} from '../api.js';
import { getConfig, getFileConfig, saveConfig } from '../config.js';
import { extractApiKey } from '../auth.js';
import { buildQuery } from '../query.js';

export interface SimpleOffer {
  title: string;
  price: number;
  retailer: string;
  expires: string;
  discountPercent: number | null;
  externalUrl?: string;
}

export function simplifyOffer(offer: Offer): SimpleOffer {
  // Build full title: "Brand Product Description"
  const parts = [
    offer.brand?.name,
    offer.product.name,
    offer.description,
  ].filter(Boolean);
  const title = parts.join(' - ');

  // Calculate discount
  let discountPercent: number | null = null;
  if (offer.oldPrice && offer.oldPrice > offer.price) {
    discountPercent = Math.round((1 - offer.price / offer.oldPrice) * 100);
  }

  // Get expiry date
  const expires = offer.validityDates[0]?.to
    ? new Date(offer.validityDates[0].to).toISOString().split('T')[0]
    : '';

  return {
    title,
    price: offer.price,
    retailer: offer.advertisers[0]?.name || 'Unknown',
    expires,
    discountPercent,
    externalUrl: offer.externalUrl ?? undefined,
  };
}

interface SimpleSearchResult {
  query: string;
  total: number;
  offers: SimpleOffer[];
}

export interface SearchCommandOptions {
  zip?: string;
  country?: string;
  limit?: number;
  retailer?: string;
  json?: boolean;
  jsonFull?: boolean;
  explain?: boolean;
}

export interface SearchBuildOptions extends SearchCommandOptions {
  term?: string[];
  phrase?: string[];
  wildcard?: string[];
  or?: string[];
  group?: string[];
}

const DEFAULT_LIMIT = 10;

interface OfferLine {
  icon?: string;
  text: string;
}

// The lines describing an offer, shared by the text output and the
// `descriptionLines` of `--json-full`.
function offerLines(offer: Offer): OfferLine[] {
  // Product name and brand
  const brand = offer.brand?.name ? `[${offer.brand.name}]` : '';
  const lines: OfferLine[] = [
    { text: `${offer.product.name} ${brand}`.trim() },
  ];

  // Price line
  const discount = formatDiscount(offer.price, offer.oldPrice);
  const priceInfo = discount
    ? `${formatPrice(offer.price)} (was ${formatPrice(offer.oldPrice!)}) ${discount}`
    : formatPrice(offer.price);

  // Unit price if available
  const unitInfo =
    offer.volume && offer.unit
      ? ` · ${formatPrice(offer.referencePrice)}/${offer.unit.shortName}`
      : '';

  lines.push({ icon: '💰', text: `${priceInfo}${unitInfo}` });

  // Description
  if (offer.description) {
    lines.push({ icon: '📦', text: offer.description });
  }

  // Retailer and validity
  const retailer = offer.advertisers[0]?.name || 'Unknown';
  const validity = formatValidity(offer.validityDates);
  lines.push({ icon: '🏪', text: `${retailer} · ${validity}` });

  if (offer.externalUrl) {
    lines.push({ icon: '🔗', text: offer.externalUrl });
  }

  return lines;
}

export function formatOfferText(offer: Offer): string {
  return offerLines(offer)
    .map(({ icon, text }) => (icon ? `  ${icon} ${text}` : text))
    .join('\n');
}

// The text output lines of an offer without icons, meant for display.
export function offerDescriptionLines(offer: Offer): string[] {
  return offerLines(offer).map(({ text }) => text);
}

export function formatResultsText(result: SearchResult, query: string): string {
  const lines: string[] = [];

  lines.push(`Found ${result.totalResults} offers for "${query}":\n`);

  if (result.results.length === 0) {
    lines.push('No offers found.');
    return lines.join('\n');
  }

  for (const offer of result.results) {
    lines.push(formatOfferText(offer));
    lines.push(''); // Empty line between offers
  }

  // Show available filters summary
  if (result.filters.retailers.length > 0) {
    const topRetailers = result.filters.retailers
      .slice(0, 5)
      .map((r) => `${r.name} (${r.resultsCount})`)
      .join(', ');
    lines.push(`📍 Retailers: ${topRetailers}`);
  }

  return lines.join('\n');
}

function normalizeLimit(limit?: number): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('Limit must be a positive number.');
  }
  return Math.floor(limit);
}

function emitWarnings(warnings: string[]): void {
  if (warnings.length === 0) return;
  for (const warning of warnings) {
    console.error(`Warning: ${warning}`);
  }
}

// Returns the key and whether it was stored in the config file.
async function login(
  quiet: boolean,
  country: string,
): Promise<{ apiKey: string; stored: boolean }> {
  // Keep stdout clean for JSON output.
  const log = quiet
    ? (msg: string) => console.error(msg)
    : (msg: string) => console.log(msg);
  log('No API key configured. Running login...');

  const apiKey = await extractApiKey({ log, country });
  // The stored key has to match the config file's country. Keys of other
  // countries (MARKTGURU_COUNTRY or a per-search country) stay in memory.
  const stored = country === (await getFileConfig()).country;
  if (stored) await saveConfig({ apiKey });
  return { apiKey, stored };
}

// Logins per country. Searches that start while a login runs (in `serve` and
// `mcp`) wait for it instead of scraping again. Keys that are not stored in
// the config file stay here for later searches.
const logins = new Map<string, Promise<string>>();

function startLogin(quiet: boolean, country: string): Promise<string> {
  const pending = login(quiet, country).then(
    ({ apiKey, stored }) => {
      if (stored) logins.delete(country);
      return apiKey;
    },
    (error: unknown) => {
      logins.delete(country);
      throw error;
    },
  );
  logins.set(country, pending);
  return pending;
}

async function ensureApiKey(quiet: boolean, country: string): Promise<string> {
  const file = await getFileConfig();
  if (file.apiKey && file.country === country) return file.apiKey;
  return logins.get(country) ?? startLogin(quiet, country);
}

// Searches and applies the client-side retailer filter and limit. Logs from
// the auto-login go to stderr when `json` or `jsonFull` is set.
export async function performSearch(
  query: string,
  options: SearchCommandOptions,
): Promise<FullSearchResult> {
  const country = options.country ?? (await getConfig()).country;
  const apiKey = await ensureApiKey(
    options.json === true || options.jsonFull === true,
    country,
  );
  // Fetch more results if filtering by retailer (we'll filter client-side)
  const limit = normalizeLimit(options.limit);
  const fetchLimit = options.retailer ? Math.max(limit, 100) : limit;

  const result = await apiSearch({
    query,
    zipCode: options.zip,
    country,
    limit: fetchLimit,
    apiKey,
  }).catch((error: unknown) => {
    // An expired key from memory: the next search logs in again.
    logins.delete(country);
    throw error;
  });

  let filteredResults = result.results;
  let totalResults = result.totalResults;

  if (options.retailer) {
    const retailerLower = options.retailer.toLowerCase();
    filteredResults = filteredResults.filter((offer) =>
      offer.advertisers.some((a) =>
        a.name.toLowerCase().includes(retailerLower),
      ),
    );
    filteredResults = filteredResults.slice(0, limit);
    totalResults = filteredResults.length;
  } else {
    filteredResults = filteredResults.slice(0, limit);
  }

  // Copy the API response so fields the CLI doesn't know pass through. The
  // first spread fixes the key order of the JSON output.
  const filtered = { totalResults, results: filteredResults };
  const ordered = { query, ...filtered, filters: result.filters };
  return { ...ordered, ...result, ...filtered };
}

export type FullOffer = Offer & { descriptionLines: string[] };

export interface JsonFullResult extends Omit<FullSearchResult, 'results'> {
  results: FullOffer[];
}

// What `--json-full` prints: the API response, filtered and limited, with
// the text output lines added to each offer.
export function toJsonFull(result: FullSearchResult): JsonFullResult {
  return {
    ...result,
    results: result.results.map((offer) => ({
      ...offer,
      descriptionLines: offerDescriptionLines(offer),
    })),
  };
}

async function runSearch(
  query: string,
  options: SearchCommandOptions,
): Promise<void> {
  const result = await performSearch(query, options);

  if (options.jsonFull) {
    console.log(JSON.stringify(toJsonFull(result), null, 2));
  } else if (options.json) {
    const simple: SimpleSearchResult = {
      query,
      total: result.totalResults,
      offers: result.results.map(simplifyOffer),
    };
    console.log(JSON.stringify(simple, null, 2));
  } else {
    console.log(formatResultsText(result, query));
  }
}

export async function searchRawCommand(
  query: string,
  options: SearchCommandOptions,
): Promise<void> {
  try {
    await runSearch(query, options);
  } catch (e) {
    console.error('Error:', (e as Error).message);
    process.exit(1);
  }
}

export async function searchBuildCommand(
  options: SearchBuildOptions,
): Promise<void> {
  try {
    const { query, warnings } = buildQuery({
      terms: options.term,
      phrases: options.phrase,
      wildcards: options.wildcard,
      ors: options.or,
      groups: options.group,
    });

    if (options.explain) {
      console.error(`Query: ${query}`);
    }
    emitWarnings(warnings);

    await runSearch(query, options);
  } catch (e) {
    console.error('Error:', (e as Error).message);
    process.exit(1);
  }
}
