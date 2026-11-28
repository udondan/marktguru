// Runs the built entrypoint as a child process; c8 collects its coverage too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { isolateHome } from './helpers.ts';

const run = promisify(execFile);
const CLI = new URL('../dist/cli.js', import.meta.url).pathname;

test('cli prints the package version', async () => {
  const pkg = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf-8'),
  ) as { version: string };
  const { stdout } = await run(process.execPath, [CLI, '--version']);
  assert.equal(stdout.trim(), pkg.version);
});

test('cli runs a command', async () => {
  const { stdout } = await run(process.execPath, [CLI, 'search', 'syntax']);
  assert.match(stdout, /^Query syntax/);
});

test('cli prints help without arguments', async () => {
  const { stdout } = await run(process.execPath, [CLI]);
  assert.match(stdout, /^Usage: marktguru /);
  assert.match(stdout, /Examples:/);
});

test('cli mcp serves the tools on stdio', async () => {
  // Sets HOME in process.env, which the server inherits along with
  // NODE_V8_COVERAGE, so c8 collects its coverage.
  await isolateHome();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, 'mcp'],
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const pkg = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf-8'),
    ) as { version: string };
    assert.equal(client.getServerVersion()?.version, pkg.version);
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['search_offers'],
    );
  } finally {
    await client.close();
  }
});
