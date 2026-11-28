import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, timingSafeEqual } from 'node:crypto';
import { performSearch, toJsonFull } from './search.js';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 3000;

const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost'];

export interface ServeOptions {
  host?: string;
  port?: number;
  token?: string;
}

export interface RunningServer {
  server: Server;
  url: string;
}

interface RequestGuard {
  token?: string;
  // `Host` headers accepted on a loopback bind, against DNS rebinding.
  // Undefined on other binds, which require a token instead.
  allowedHosts?: Set<string>;
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

// Hashing both sides gives equal lengths for the constant-time comparison.
function tokenMatches(header: string | undefined, token: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${token}`));
}

function checkRequest(req: IncomingMessage, guard: RequestGuard): void {
  // HTTP/1.0 requests may come without a Host header.
  const host = (req.headers.host ?? '').toLowerCase();
  // Clients leave out the default port 80.
  const hostWithPort = /:\d+$/.test(host) ? host : `${host}:80`;
  if (guard.allowedHosts && !guard.allowedHosts.has(hostWithPort)) {
    throw new HttpError(403, 'Host not allowed');
  }
  const origin = req.headers.origin;
  if (origin !== undefined && origin.toLowerCase() !== `http://${host}`) {
    throw new HttpError(403, 'Cross-origin requests are not allowed');
  }
  if (guard.token && !tokenMatches(req.headers.authorization, guard.token)) {
    throw new HttpError(401, 'Missing or invalid bearer token');
  }
}

function parseLimit(value: string | null): number | undefined {
  if (value === null) return undefined;
  const limit = Number(value);
  if (!/^\d+$/.test(value) || limit <= 0) {
    throw new HttpError(400, 'limit must be a positive integer');
  }
  return limit;
}

function parseZip(value: string | null): string | undefined {
  if (value === null) return undefined;
  if (!/^\d{4,5}$/.test(value)) {
    throw new HttpError(400, 'zip must have 4 or 5 digits');
  }
  return value;
}

async function searchRoute(params: URLSearchParams): Promise<unknown> {
  const query = params.get('q')?.trim();
  if (!query) throw new HttpError(400, 'q is required');
  const options = {
    limit: parseLimit(params.get('limit')),
    zip: parseZip(params.get('zip')),
    retailer: params.get('retailer') ?? undefined,
    jsonFull: true,
  };
  try {
    return toJsonFull(await performSearch(query, options));
  } catch (e) {
    throw new HttpError(502, (e as Error).message);
  }
}

const ROUTES: Record<string, (params: URLSearchParams) => Promise<unknown>> = {
  '/health': () => Promise.resolve({ success: true }),
  '/search': searchRoute,
};

function parseUrl(req: IncomingMessage): URL {
  try {
    // Requests to a server always carry a URL.
    return new URL(String(req.url), 'http://localhost');
  } catch {
    throw new HttpError(400, 'Invalid request URL');
  }
}

async function respond(
  req: IncomingMessage,
  res: ServerResponse,
  guard: RequestGuard,
): Promise<unknown> {
  checkRequest(req, guard);
  const url = parseUrl(req);
  if (!Object.hasOwn(ROUTES, url.pathname)) {
    throw new HttpError(404, 'Not found');
  }
  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET');
    throw new HttpError(405, 'Method not allowed');
  }
  return ROUTES[url.pathname](url.searchParams);
}

// Every error thrown while responding is an HttpError.
function handle(
  req: IncomingMessage,
  res: ServerResponse,
  guard: RequestGuard,
): void {
  respond(req, res, guard).then(
    (body) => send(res, 200, body),
    (error: HttpError) =>
      send(res, error.status, { success: false, error: error.message }),
  );
}

function loopbackHosts(port: number): Set<string> {
  return new Set(
    ['127.0.0.1', 'localhost', '[::1]'].map((name) => `${name}:${port}`),
  );
}

// Starts the HTTP API. Binding to anything but loopback requires a token.
export async function startServer(
  options: ServeOptions = {},
): Promise<RunningServer> {
  const host = options.host ?? DEFAULT_HOST;
  const token = options.token === '' ? undefined : options.token;
  const loopback = LOOPBACK_HOSTS.includes(host);
  if (!loopback && !token) {
    throw new Error(
      `Refusing to listen on ${host} without a token. Pass --token or set MARKTGURU_SERVE_TOKEN.`,
    );
  }

  const guard: RequestGuard = { token };
  const server = createServer((req, res) => handle(req, res, guard));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? DEFAULT_PORT, host, resolve);
  });

  const { port } = server.address() as AddressInfo;
  if (loopback) guard.allowedHosts = loopbackHosts(port);
  const displayHost = host.includes(':') ? `[${host}]` : host;
  return { server, url: `http://${displayHost}:${port}` };
}

export async function serveCommand(options: ServeOptions): Promise<void> {
  try {
    const { server, url } = await startServer({
      ...options,
      token: options.token ?? process.env.MARKTGURU_SERVE_TOKEN,
    });
    console.error(`Listening on ${url}`);
    const stop = () => {
      server.close(() => process.exit(0));
      server.closeAllConnections();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (e) {
    console.error('Error:', (e as Error).message);
    process.exit(1);
  }
}
