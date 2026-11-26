import { Command, InvalidArgumentError } from 'commander';
import { login } from './commands/login.js';
import {
  searchBuildCommand,
  searchRawCommand,
  type SearchBuildOptions,
  type SearchCommandOptions,
} from './commands/search.js';
import {
  configCommand,
  setCountryCommand,
  setZipCommand,
} from './commands/config.js';
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  serveCommand,
  type ServeOptions,
} from './commands/serve.js';
import { mcpCommand } from './commands/mcp.js';
import { QUERY_SYNTAX_HELP } from './query.js';

type JsonFlag = (options: { json?: boolean }) => boolean;

const parsePositiveInt = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('Value must be a positive integer.');
  }
  return parsed;
};

const parsePort = (value: string): number => {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || parsed > 65535) {
    throw new InvalidArgumentError('Value must be a port between 0 and 65535.');
  }
  return parsed;
};

const collectValues = (value: string, previous: string[]): string[] => {
  previous.push(value);
  return previous;
};

function registerLoginCommand(program: Command, getJsonFlag: JsonFlag): void {
  program
    .command('login')
    .description('Extract API key from marktguru.at/de via HTTP')
    .option('-j, --json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      await login({ ...options, json: getJsonFlag(options) });
    });
}

// Options shared by `search raw` and `search build`.
function addSearchOptions(command: Command): Command {
  return command
    .option('-z, --zip <code>', 'ZIP code for location-based results')
    .option(
      '-n, --limit <number>',
      'Number of results (default: 10)',
      parsePositiveInt,
    )
    .option(
      '-r, --retailer <name>',
      'Filter by retailer (e.g., SPAR, BILLA, HOFER)',
    )
    .option('-j, --json', 'Output JSON')
    .option(
      '--json-full',
      'Output the complete API response as JSON (takes precedence over --json)',
    );
}

function registerSearchCommands(program: Command, getJsonFlag: JsonFlag): void {
  const search = program
    .command('search')
    .description('Search for product deals using the Marktguru query syntax');

  addSearchOptions(
    search
      .command('raw <query>')
      .description('Search using a raw query string'),
  ).action(async (query: string, options: SearchCommandOptions) => {
    await searchRawCommand(query, { ...options, json: getJsonFlag(options) });
  });

  addSearchOptions(
    search
      .command('build')
      .description('Build a query from structured flags')
      .option('--term <value>', 'Add a term', collectValues, [])
      .option('--phrase <value>', 'Add an exact phrase', collectValues, [])
      .option(
        '--wildcard <value>',
        'Add a wildcard term (e.g., kell*)',
        collectValues,
        [],
      )
      .option('--or <value>', 'Add a term to the OR group', collectValues, [])
      .option(
        '--group <value>',
        'Add a raw group (wrapped in parentheses)',
        collectValues,
        [],
      )
      .option('--explain', 'Print the built query to stderr'),
  ).action(async (options: SearchBuildOptions) => {
    await searchBuildCommand({ ...options, json: getJsonFlag(options) });
  });

  search
    .command('syntax')
    .description('Show supported query syntax')
    .action(() => {
      console.log(QUERY_SYNTAX_HELP);
    });

  search.action(() => {
    search.outputHelp();
  });
}

function registerConfigCommands(program: Command, getJsonFlag: JsonFlag): void {
  program
    .command('set-zip <code>')
    .description('Set default ZIP code for searches')
    .option('-j, --json', 'Output JSON')
    .action(async (code: string, options: { json?: boolean }) => {
      await setZipCommand(code, { json: getJsonFlag(options) });
    });

  program
    .command('set-country <code>')
    .description('Set default country for searches (at, de)')
    .option('-j, --json', 'Output JSON')
    .action(async (code: string, options: { json?: boolean }) => {
      await setCountryCommand(code, { json: getJsonFlag(options) });
    });

  program
    .command('config')
    .description('Show current configuration')
    .option('-j, --json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      await configCommand({ json: getJsonFlag(options) });
    });
}

function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Run a local, read-only HTTP API (GET /search, GET /health)')
    .option('--host <address>', 'Address to listen on', DEFAULT_HOST)
    .option(
      '--port <number>',
      'Port to listen on, 0 picks a free one',
      parsePort,
      DEFAULT_PORT,
    )
    .option(
      '--token <token>',
      'Require "Authorization: Bearer <token>" (default: $MARKTGURU_SERVE_TOKEN)',
    )
    .addHelpText(
      'after',
      [
        '',
        'Security:',
        '  Listens on 127.0.0.1 by default. Any other address requires a token.',
        '  Requests with a foreign Origin, or a Host other than the loopback',
        '  address on a loopback bind, are rejected. No endpoint changes the',
        '  config or returns the API key.',
        '',
        'Endpoints:',
        '  GET /health',
        '  GET /search?q=<query>[&limit=<n>][&zip=<code>][&retailer=<name>]',
        '      Returns the same JSON as `search raw --json-full`.',
      ].join('\n'),
    )
    .action(async (options: ServeOptions) => {
      await serveCommand(options);
    });
}

function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Run an MCP server on stdio (tool: search_offers)')
    .action(async () => {
      await mcpCommand(String(program.version()));
    });
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('marktguru')
    .description(
      'Marktguru supermarket deals (AT/DE): CLI, HTTP API and MCP server',
    )
    .version('1.1.0') // x-release-please-version
    .option('-j, --json', 'Output JSON (for all commands)');

  program.addHelpText(
    'afterAll',
    [
      '',
      'Examples:',
      '  $ marktguru login',
      '  $ marktguru search raw "kellys OR \\"erdnuss snips\\""',
      '  $ marktguru search build --term kellys --phrase "erdnuss snips" --or manner --explain',
      '  $ marktguru search syntax',
      '',
      'Environment:',
      '  MARKTGURU_COUNTRY  Country, overrides the config (at, de)',
      '  MARKTGURU_ZIP      Default ZIP code, overrides the config',
      '',
    ].join('\n'),
  );

  const getJsonFlag: JsonFlag = (options) =>
    Boolean(options.json ?? program.opts().json);

  registerLoginCommand(program, getJsonFlag);
  registerSearchCommands(program, getJsonFlag);
  registerConfigCommands(program, getJsonFlag);
  registerServeCommand(program);
  registerMcpCommand(program);

  return program;
}

export async function run(argv: string[]): Promise<void> {
  const program = createProgram();
  if (argv.length <= 2) {
    program.outputHelp();
    return;
  }
  await program.parseAsync(argv);
}
