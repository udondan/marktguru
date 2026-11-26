import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { connect } from 'node:net';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Server } from 'node:http';
import {
  isolateHome,
  mockFetch,
  json,
  text,
  makeOffer,
  makeResult,
  spawnServer,
  type FullSearchOutput,
} from './helpers.ts';

const home = await isolateHome();
const { startServer } = await import('../dist/commands/serve.js');
const { saveConfig } = await import('../dist/config.js');

interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

// node:http instead of fetch, which the tests mock for the upstream API.
function call(
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => (data += chunk.toString()));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: JSON.parse(data) as Record<string, unknown>,
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

const servers: Server[] = [];

async function serve(options: Parameters<typeof startServer>[0] = {}) {
  const running = await startServer({ port: 0, ...options });
  servers.push(running.server);
  return running.url;
}

test.afterEach(async () => {
  mock.restoreAll();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await rm(join(home, '.marktguru'), { recursive: true, force: true });
});

test('health', async () => {
  const url = await serve();

  const res = await call(`${url}/health`);

  assert.equal(res.status, 200);
  assert.match(String(res.headers['content-type']), /^application\/json/);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  assert.deepEqual(res.body, { success: true });
});

test('search returns the --json-full shape', async () => {
  await saveConfig({ apiKey: 'stored-key' });
  const calls = mockFetch(() =>
    json(
      makeResult(
        [
          makeOffer({ id: 1, advertisers: [{ name: 'SPAR' }] }),
          makeOffer({ id: 2, advertisers: [{ name: 'BILLA' }] }),
          makeOffer({ id: 3, advertisers: [{ name: 'Interspar' }] }),
        ],
        { totalResults: 50 },
      ),
    ),
  );
  const url = await serve();

  const res = await call(
    `${url}/search?q=chips&limit=1&zip=10115&retailer=spar`,
  );

  assert.equal(res.status, 200);
  const upstream = new URL(calls[0].url);
  assert.equal(upstream.searchParams.get('q'), 'chips');
  assert.equal(upstream.searchParams.get('zipCode'), '10115');
  assert.equal(upstream.searchParams.get('limit'), '100');
  const body = res.body as unknown as FullSearchOutput;
  assert.equal(body.query, 'chips');
  assert.equal(body.totalResults, 1);
  assert.deepEqual(
    body.results.map((offer) => offer.id),
    [1],
  );
  assert.equal(body.results[0].descriptionLines[0], 'Test Chips [SnackCo]');
});

test('search logs in once for concurrent requests', async () => {
  const key = 'auto-key-1234567890';
  const calls = mockFetch((url, init) => {
    if (url.includes('/offers/search')) {
      return init.headers['x-apikey'] === key
        ? json(makeResult([]))
        : text('', 401);
    }
    if (url.endsWith('/app.js')) return text(`apiKey: "${key}"`);
    return text('<script src="/app.js"></script>');
  });
  mock.method(console, 'error', () => undefined);
  const url = await serve();

  const responses = await Promise.all([
    call(`${url}/search?q=a`),
    call(`${url}/search?q=b`),
  ]);

  assert.deepEqual(
    responses.map((res) => res.status),
    [200, 200],
  );
  const pages = calls.filter((c) => !c.url.includes('/offers/search'));
  assert.equal(pages.filter((c) => c.url.endsWith('/app.js')).length, 1);
});

test('search rejects invalid parameters', async () => {
  const calls = mockFetch(() => json(makeResult([])));
  const url = await serve();

  for (const [query, error] of [
    ['', 'q is required'],
    ['q=%20', 'q is required'],
    ['q=x&limit=0', 'limit must be a positive integer'],
    ['q=x&limit=1.5', 'limit must be a positive integer'],
    ['q=x&zip=abc', 'zip must have 4 or 5 digits'],
  ]) {
    const res = await call(`${url}/search?${query}`);
    assert.equal(res.status, 400, query);
    assert.deepEqual(res.body, { success: false, error });
  }
  assert.equal(calls.length, 0);
});

test('search reports upstream errors as 502', async () => {
  await saveConfig({ apiKey: 'stored-key' });
  mockFetch(() => text('', 401));
  const url = await serve();

  const res = await call(`${url}/search?q=x`);

  assert.equal(res.status, 502);
  assert.match(String(res.body.error), /API key invalid or expired/);
});

test('unknown paths and methods', async () => {
  const url = await serve();

  const missing = await call(`${url}/login`);
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.body, { success: false, error: 'Not found' });

  const inherited = await call(`${url}/toString`);
  assert.equal(inherited.status, 404);

  const post = await call(`${url}/search`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET');
});

test('rejects foreign Host headers on loopback', async () => {
  const url = await serve();
  const { port } = new URL(url);

  for (const host of ['evil.example', `evil.example:${port}`, '127.0.0.1:1']) {
    const res = await call(`${url}/health`, { headers: { host } });
    assert.equal(res.status, 403, host);
    assert.equal(res.body.error, 'Host not allowed');
  }
  for (const host of [`localhost:${port}`, `LOCALHOST:${port}`]) {
    const res = await call(`${url}/health`, { headers: { host } });
    assert.equal(res.status, 200, host);
  }
});

// Raw socket for requests node:http clients refuse to send.
function rawRequest(url: URL, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(Number(url.port), url.hostname, () =>
      socket.end(request),
    );
    let data = '';
    socket.on('data', (chunk: Buffer) => (data += chunk.toString()));
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

test('rejects HTTP/1.0 requests without a Host header on loopback', async () => {
  const url = new URL(await serve());

  const response = await rawRequest(url, 'GET /health HTTP/1.0\r\n\r\n');

  assert.match(response, /^HTTP\/1\.1 403 /);
  assert.match(response, /Host not allowed/);
});

test('rejects a Host without port unless the server is on port 80', async () => {
  const url = await serve();

  const res = await call(`${url}/health`, { headers: { host: 'localhost' } });

  assert.equal(res.status, 403);
});

test('rejects unparsable request targets and keeps running', async () => {
  const url = new URL(await serve());

  const response = await rawRequest(
    url,
    `GET //[ HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`,
  );

  assert.match(response, /^HTTP\/1\.1 400 /);
  assert.match(response, /Invalid request URL/);
  const res = await call(`${url.href}health`);
  assert.equal(res.status, 200);
});

test('rejects foreign Origin headers', async () => {
  const url = await serve();

  const foreign = await call(`${url}/health`, {
    headers: { origin: 'http://evil.example' },
  });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.error, 'Cross-origin requests are not allowed');

  const same = await call(`${url}/health`, { headers: { origin: url } });
  assert.equal(same.status, 200);
});

test('requires the bearer token when one is set', async () => {
  const url = await serve({ token: 'secret' });

  for (const authorization of [undefined, 'Bearer wrong', 'secret']) {
    const headers: Record<string, string> = authorization
      ? { authorization }
      : {};
    const res = await call(`${url}/health`, { headers });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Missing or invalid bearer token');
  }

  const ok = await call(`${url}/health`, {
    headers: { authorization: 'Bearer secret' },
  });
  assert.equal(ok.status, 200);
});

test('non-loopback hosts need a token and skip the Host check', async () => {
  await assert.rejects(startServer({ host: '0.0.0.0', port: 0 }), {
    message: /Refusing to listen on 0\.0\.0\.0 without a token/,
  });
  await assert.rejects(startServer({ host: '0.0.0.0', port: 0, token: '' }), {
    message: /without a token/,
  });

  const url = await serve({ host: '0.0.0.0', token: 'secret' });
  const res = await call(`${url}/health`, {
    headers: { authorization: 'Bearer secret', host: 'my-server.lan' },
  });
  assert.equal(res.status, 200);
});

test('IPv6 loopback', async () => {
  const url = await serve({ host: '::1' });
  assert.match(url, /^http:\/\/\[::1\]:\d+$/);

  const res = await call(`${url}/health`);
  assert.equal(res.status, 200);
});

test('startServer fails when the port is taken', async () => {
  const url = await serve();
  const port = Number(new URL(url).port);

  await assert.rejects(startServer({ port }), { code: 'EADDRINUSE' });
});

test('startServer uses the default port', async () => {
  // Takes port 3000 only for a moment; skip when something else has it.
  try {
    const url = await serve({ port: undefined });
    assert.equal(new URL(url).port, '3000');
  } catch (e) {
    assert.equal((e as NodeJS.ErrnoException).code, 'EADDRINUSE');
  }
});

// The spawned CLI, so the signal handling and option parsing are covered.
test('serve command listens and stops on SIGTERM', async () => {
  const child = await spawnServer(home, ['--port', '0']);
  const res = await call(`${child.url}/health`);
  assert.equal(res.status, 200);

  assert.equal(await child.stop('SIGTERM'), 0);
});

test('serve command stops on SIGINT and reads the token from the env', async () => {
  const env: Record<string, string> = {};
  env.MARKTGURU_SERVE_TOKEN = 'from-env';
  const child = await spawnServer(home, ['--port', '0'], env);
  const denied = await call(`${child.url}/health`);
  const ok = await call(`${child.url}/health`, {
    headers: { authorization: 'Bearer from-env' },
  });

  assert.equal(denied.status, 401);
  assert.equal(ok.status, 200);
  assert.equal(await child.stop('SIGINT'), 0);
});

test('serve command refuses a public host without a token', async () => {
  await assert.rejects(spawnServer(home, ['--host', '0.0.0.0']), {
    message: /exited with 1: Error: Refusing to listen on 0\.0\.0\.0/,
  });
});
