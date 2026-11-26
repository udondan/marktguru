import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isolateHome } from './helpers.ts';

const home = await isolateHome();
const {
  getConfig,
  getFileConfig,
  saveConfig,
  defaultZipCode,
  DEFAULT_COUNTRY,
} = await import('../dist/config.js');
const configDir = join(home, '.marktguru');
const configFile = join(configDir, 'config.json');

test.beforeEach(async () => {
  await rm(configDir, { recursive: true, force: true });
});

test('getConfig returns defaults when no config file exists', async () => {
  assert.deepEqual(await getConfig(), {
    country: DEFAULT_COUNTRY,
    configPath: configFile,
  });
});

test('getConfig returns defaults when the config file is not valid JSON', async () => {
  await mkdir(configDir, { recursive: true });
  await writeFile(configFile, '{not json');
  assert.deepEqual(await getConfig(), {
    country: DEFAULT_COUNTRY,
    configPath: configFile,
  });
});

test('getConfig treats empty and null values as unset', async () => {
  await mkdir(configDir, { recursive: true });
  await writeFile(
    configFile,
    JSON.stringify({ apiKey: null, zipCode: '', country: '' }),
  );
  assert.deepEqual(await getConfig(), {
    country: DEFAULT_COUNTRY,
    configPath: configFile,
  });
});

test('saveConfig creates the directory, merges and omits configPath', async () => {
  await saveConfig({ zipCode: '1020' });
  await saveConfig({ apiKey: 'secret-key', country: 'de' });

  const persisted: unknown = JSON.parse(await readFile(configFile, 'utf-8'));
  assert.deepEqual(persisted, {
    country: 'de',
    zipCode: '1020',
    apiKey: 'secret-key',
  });

  assert.deepEqual(await getConfig(), {
    country: 'de',
    zipCode: '1020',
    apiKey: 'secret-key',
    configPath: configFile,
  });
});

test('environment variables override the config file but are not saved', async () => {
  await saveConfig({ apiKey: 'at-key', country: 'at', zipCode: '1020' });
  process.env.MARKTGURU_COUNTRY = 'DE';
  process.env.MARKTGURU_ZIP = '10115';
  try {
    assert.deepEqual(await getConfig(), {
      apiKey: 'at-key',
      country: 'de',
      zipCode: '10115',
      configPath: configFile,
    });
    assert.equal((await getFileConfig()).country, 'at');

    await saveConfig({ apiKey: 'new-key' });
  } finally {
    delete process.env.MARKTGURU_COUNTRY;
    delete process.env.MARKTGURU_ZIP;
  }

  const persisted: unknown = JSON.parse(await readFile(configFile, 'utf-8'));
  assert.deepEqual(persisted, {
    apiKey: 'new-key',
    country: 'at',
    zipCode: '1020',
  });
});

test('empty environment variables count as unset', async () => {
  process.env.MARKTGURU_COUNTRY = '';
  process.env.MARKTGURU_ZIP = '';
  try {
    assert.deepEqual(await getConfig(), {
      country: DEFAULT_COUNTRY,
      configPath: configFile,
    });
  } finally {
    delete process.env.MARKTGURU_COUNTRY;
    delete process.env.MARKTGURU_ZIP;
  }
});

test('a config file without a country belongs to Austria', async () => {
  // Written by a version that defaulted to Austria and didn't store it.
  await mkdir(configDir, { recursive: true });
  await writeFile(configFile, JSON.stringify({ apiKey: 'at-key' }));

  assert.equal((await getConfig()).country, 'at');
  assert.equal((await getFileConfig()).country, 'at');

  await saveConfig({ zipCode: '1020' });
  const persisted: unknown = JSON.parse(await readFile(configFile, 'utf-8'));
  assert.deepEqual(persisted, {
    country: 'at',
    apiKey: 'at-key',
    zipCode: '1020',
  });
});

test('saveConfig stores the default country in a new config file', async () => {
  await saveConfig({ apiKey: 'de-key' });

  const persisted: unknown = JSON.parse(await readFile(configFile, 'utf-8'));
  assert.deepEqual(persisted, { country: 'de', apiKey: 'de-key' });
});

test('defaultZipCode depends on the country', () => {
  assert.equal(defaultZipCode('de'), '10115');
  assert.equal(defaultZipCode('at'), '1010');
  assert.equal(defaultZipCode('fr'), '10115');
});
