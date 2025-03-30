import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

// CLI Options interface
export interface CliOptions {
  orgs: string
  topRepos?: number
  maxBranches: number
  maxRepos?: number
}

// Parse command line arguments
export const parseArgs = () => {
  return yargs(hideBin(process.argv))
    .option('orgs', {
      type: 'string',
      description: 'Comma-separated list of GitHub organizations to process',
      default: 'jj-vcs',
    })
    .option('top-repos', {
      type: 'number',
      description: 'Number of top repositories by stars to process instead of organizations',
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
    .help()
    .alias('help', 'h')
    .argv
}

// Get CLI options
export const getCliOptions = (): CliOptions => {
  const argv = parseArgs()
  return {
    orgs: argv.orgs as string,
    topRepos: argv['top-repos'] as number | undefined,
    maxBranches: argv['max-branches'] as number,
    maxRepos: argv['max-repos'] as number | undefined,
  }
}
