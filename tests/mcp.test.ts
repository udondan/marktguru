import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  isolateHome,
  mockFetch,
  json,
  text,
  makeOffer,
  makeResult,
  type FullSearchOutput,
  type SearchOutput,
} from './helpers.ts';

const home = await isolateHome();
const { createServer } = await import('../dist/commands/mcp.js');
const { getConfig, saveConfig } = await import('../dist/config.js');

interface ToolReply {
  isError?: boolean;
  content: { type: string; text: string }[];
}

async function connect(): Promise<Client> {
  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  await createServer('1.2.3').connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  return client;
}

async function searchOffers(args: Record<string, unknown>): Promise<ToolReply> {
  const client = await connect();
  try {
    return (await client.callTool({
      name: 'search_offers',
      arguments: args,
    })) as ToolReply;
  } finally {
    await client.close();
  }
}

// A site whose app.js embeds the current `site.key`, which the search
// endpoint accepts.
function site() {
  const state = { key: 'de-key-1234567890' };
  const calls = mockFetch((url, init) => {
    if (url.includes('/offers/search')) {
      return init.headers['x-apikey'] === state.key
        ? json(makeResult([]))
        : text('', 401);
    }
    if (url.endsWith('/app.js')) return text(`apiKey: "${state.key}"`);
    return text('<script src="/app.js"></script>');
  });
  const scrapes = () => calls.filter((call) => call.url.endsWith('/app.js'));
  return { state, calls, scrapes };
}

test.beforeEach(async () => {
  await saveConfig({ apiKey: 'stored-key', country: 'at' });
});

test.afterEach(async () => {
  mock.restoreAll();
  delete process.env.MARKTGURU_COUNTRY;
  await rm(join(home, '.marktguru'), { recursive: true, force: true });
});

test('mcp server reports its version and the search tool', async () => {
  const client = await connect();
  try {
    assert.deepEqual(client.getServerVersion(), {
      name: 'marktguru',
      version: '1.2.3',
    });
    assert.match(String(client.getInstructions()), /Query syntax/);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint]),
      [['search_offers', true]],
    );
  } finally {
    await client.close();
  }
});

test('search_offers returns text by default', async () => {
  const calls = mockFetch(() => json(makeResult([makeOffer()])));

  const reply = await searchOffers({ query: 'chips' });

  assert.equal(reply.isError, undefined);
  assert.match(reply.content[0].text, /^Found 1 offers for "chips":/);
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('limit'), '10');
  assert.equal(calls[0].init.headers['x-apikey'], 'stored-key');
});

test('search_offers returns compact JSON with limit, zip and retailer', async () => {
  const offers = [
    makeOffer({ id: 1, advertisers: [{ name: 'SPAR' }] }),
    makeOffer({ id: 2 }),
    makeOffer({ id: 3 }),
  ];
  const calls = mockFetch(() => json(makeResult(offers)));

  const reply = await searchOffers({
    query: 'chips',
    limit: 1,
    zip: '1020',
    retailer: 'billa',
    format: 'json',
  });

  const output = JSON.parse(reply.content[0].text) as SearchOutput;
  assert.equal(output.total, 1);
  assert.deepEqual(
    output.offers.map((offer) => offer.retailer),
    ['BILLA PLUS'],
  );
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('zipCode'), '1020');
  assert.equal(url.searchParams.get('limit'), '100');
});

test('search_offers returns the full API response with json-full', async () => {
  mockFetch(() => json(makeResult([makeOffer()])));

  const reply = await searchOffers({ query: 'chips', format: 'json-full' });

  const output = JSON.parse(reply.content[0].text) as FullSearchOutput;
  assert.equal(output.query, 'chips');
  assert.equal(output.results[0].descriptionLines.length > 0, true);
});

test('search_offers reports API errors as tool errors', async () => {
  mockFetch(() => text('', 500));

  const reply = await searchOffers({ query: 'chips' });

  assert.equal(reply.isError, true);
  assert.match(reply.content[0].text, /^Error: API error: 500/);
});

test('search_offers rejects invalid arguments', async () => {
  const calls = mockFetch(() => json(makeResult([])));

  const reply = await searchOffers({ query: 'chips', zip: 'abc' });

  assert.equal(reply.isError, true);
  assert.equal(calls.length, 0);
});

// Runs before the next test, which keeps a key for de in memory.
test('search_offers reports a failed login and tries again next time', async () => {
  const calls = mockFetch(() => text('<html></html>'));

  const first = await searchOffers({ query: 'chips', country: 'de' });
  const requestsOfFirstLogin = calls.length;
  const second = await searchOffers({ query: 'chips', country: 'de' });

  assert.match(first.content[0].text, /^Error: /);
  assert.equal(first.isError, true);
  assert.equal(second.isError, true);
  assert.equal(calls.length, 2 * requestsOfFirstLogin);
});

// One test, since the keys in memory outlive a test.
test('search_offers keeps keys of other countries in memory', async () => {
  process.env.MARKTGURU_COUNTRY = 'de';
  const { state, calls, scrapes } = site();

  await searchOffers({ query: 'chips' });
  const second = await searchOffers({ query: 'milch', country: 'de' });

  assert.equal(second.isError, undefined);
  const origins = new Set(calls.map((call) => new URL(call.url).hostname));
  assert.deepEqual([...origins], ['www.marktguru.de', 'api.marktguru.de']);
  // One scrape, and the stored key of the configured country stays.
  assert.equal(scrapes().length, 1);
  assert.equal((await getConfig()).apiKey, 'stored-key');

  // A key from memory that stopped working is fetched again.
  state.key = 'new-key-1234567890';
  const failed = await searchOffers({ query: 'chips' });
  const retried = await searchOffers({ query: 'chips' });

  assert.equal(failed.isError, true);
  assert.equal(retried.isError, undefined);
  assert.equal(scrapes().length, 2);
});
