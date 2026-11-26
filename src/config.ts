import { homedir } from 'os';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';

export interface Config {
  apiKey?: string;
  zipCode?: string;
  country?: string;
  configPath: string;
}

export const DEFAULT_COUNTRY = 'de';
export const VALID_COUNTRIES = ['at', 'de'] as const;
export type Country = (typeof VALID_COUNTRIES)[number];

// ZIP codes of searches that set none: Berlin and Vienna.
const DEFAULT_ZIP_CODES: Record<string, string> = { de: '10115', at: '1010' };

export function defaultZipCode(country: string): string {
  return DEFAULT_ZIP_CODES[country] ?? DEFAULT_ZIP_CODES[DEFAULT_COUNTRY];
}

// Austria was the default country before, and the country was only written to
// the config file by set-country. A config file without a country therefore
// belongs to Austria, including its API key; a missing file to the default.
function fallbackCountry(file: Partial<Config>): string {
  return Object.keys(file).length > 0 ? 'at' : DEFAULT_COUNTRY;
}

const CONFIG_DIR = join(homedir(), '.marktguru');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

// The config as loaded: the country falls back to the default.
export type LoadedConfig = Config & { country: string };

// Empty or null values in a hand-edited config file count as unset.
function withoutEmptyValues(parsed: Partial<Config>): Partial<Config> {
  return Object.fromEntries(
    Object.entries(parsed).filter(
      ([, value]) => value !== '' && value !== null && value !== undefined,
    ),
  );
}

async function readConfigFile(): Promise<Partial<Config>> {
  try {
    const data = await readFile(CONFIG_FILE, 'utf-8');
    return withoutEmptyValues(JSON.parse(data) as Partial<Config>);
  } catch {
    return {};
  }
}

// MARKTGURU_COUNTRY and MARKTGURU_ZIP override the config file, for example
// in the Docker image, which has no config file.
function fromEnvironment(): Partial<Config> {
  return withoutEmptyValues({
    country: process.env.MARKTGURU_COUNTRY?.toLowerCase(),
    zipCode: process.env.MARKTGURU_ZIP,
  });
}

// The config file alone. Its country is the one the stored API key belongs
// to: login and set-country keep the two in sync, the environment doesn't.
export async function getFileConfig(): Promise<LoadedConfig> {
  const parsed = await readConfigFile();
  return {
    country: fallbackCountry(parsed),
    ...parsed,
    configPath: CONFIG_FILE,
  };
}

// The config file with the environment overrides applied.
export async function getConfig(): Promise<LoadedConfig> {
  const file = await readConfigFile();
  return {
    country: fallbackCountry(file),
    ...file,
    ...fromEnvironment(),
    configPath: CONFIG_FILE,
  };
}

// Writes only to the config file, environment overrides are not persisted.
// The country is always written, so it stays the same when the default
// changes.
export async function saveConfig(config: Partial<Config>): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  const file = await readConfigFile();
  const merged = { country: fallbackCountry(file), ...file, ...config };
  const { configPath: _configPath, ...persisted } = merged;
  await writeFile(CONFIG_FILE, JSON.stringify(persisted, null, 2));
}
