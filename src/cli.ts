import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

// CLI Options interface
export interface CliOptions {
  owners: string[]
  repos: string[]
  topRepos?: number
  maxBranches: number
  maxRepos?: number
  includePrs: boolean
  maxPrs: number
  prStatus: 'open' | 'closed' | 'all'
  forceRefresh: boolean
  clearCache: boolean
}

// Parse command line arguments
export const parseArgs = () => {
  return yargs(hideBin(process.argv))
    .option('owner', {
      type: 'string',
      description:
        'GitHub organization or user to process (can be used multiple times, automatically detects if owner is an org or user)',
      demandOption: false,
      array: true,
      default: [],
    })
    .option('repo', {
      type: 'string',
      description: 'Specific repository to process in the format "owner/repo" (can be used multiple times)',
      demandOption: false,
      array: true,
      default: [],
    })
    .option('top-repos', {
      type: 'number',
      description: 'Number of top repositories by stars to process',
      demandOption: false,
    })
    .option('max-branches', {
      type: 'number',
      description: 'Maximum number of branches to fetch per repository',
      default: 1000,
    })
    .option('max-repos', {
      type: 'number',
      description: 'Maximum number of repositories to process',
      demandOption: false,
    })
    .option('include-prs', {
      type: 'boolean',
      description: 'Include pull requests in the search',
      default: false,
    })
    .option('max-prs', {
      type: 'number',
      description: 'Maximum number of pull requests to fetch per repository',
      default: 100,
    })
    .option('pr-status', {
      type: 'string',
      description: 'Status of pull requests to include (open, closed, or all)',
      choices: ['open', 'closed', 'all'],
      default: 'all',
    })
    .option('force-refresh', {
      type: 'boolean',
      description: 'Force refreshing data from GitHub, ignoring cache',
      default: false,
    })
    .option('clear-cache', {
      type: 'boolean',
      description: 'Clear the cache before running',
      default: false,
    })
    .check((argv) => {
      // Ensure we have at least one source of repositories
      if (argv.owner.length === 0 && argv.repo.length === 0 && !argv['top-repos']) {
        throw new Error('At least one of --owner, --repo, or --top-repos must be specified')
      }

      // Validate repo format (owner/repo)
      if (argv.repo && argv.repo.length > 0) {
        for (const repo of argv.repo as string[]) {
          if (!repo || !repo.includes('/') || repo.split('/').length !== 2) {
            throw new Error(`Invalid repository format: "${repo}". Use the format "owner/repo"`)
          }
        }
      }

      return true
    })
    .help()
    .alias('help', 'h')
    .argv
}

// Get CLI options
export const getCliOptions = (): CliOptions => {
  const argv = parseArgs()
  return {
    owners: argv.owner as string[],
    repos: argv.repo as string[],
    topRepos: argv['top-repos'] as number | undefined,
    maxBranches: argv['max-branches'] as number,
    maxRepos: argv['max-repos'] as number | undefined,
    includePrs: argv['include-prs'] as boolean,
    maxPrs: argv['max-prs'] as number,
    prStatus: argv['pr-status'] as 'open' | 'closed' | 'all',
    forceRefresh: argv['force-refresh'] as boolean,
    clearCache: argv['clear-cache'] as boolean,
  }
}
