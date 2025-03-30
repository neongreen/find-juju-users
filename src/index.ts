import { exec } from 'child_process'
import { promisify } from 'util'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

const execAsync = promisify(exec)

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
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

// CLI Options
interface CliOptions {
  orgs: string
  topRepos?: number
  maxBranches: number
  maxRepos?: number
}

// Types
interface Repository {
  name: string
  owner: {
    login: string
  }
  url: string
  stars?: number
}

interface Branch {
  name: string
  commit: {
    sha: string
    url: string
  }
}

interface BranchMatch {
  repository: string
  branch: string
  username?: string // Extracted username from branch pattern
}

interface UserStats {
  username: string
  count: number
}

interface RepoStats {
  repository: string
  totalBranches: number
  userStats: UserStats[]
}

/**
 * Fetches repositories from the jj-vcs organization using GitHub CLI
 */
async function getRepositories(organization: string): Promise<Repository[]> {
  const repositories: Repository[] = []

  try {
    console.log(`Fetching repositories from ${organization} organization...`)
    // Use a larger limit value to get more repositories at once
    const { stdout } = await execAsync(`gh repo list ${organization} --json name,owner,url --limit 1000`)

    const reposOnPage: Repository[] = JSON.parse(stdout)
    repositories.push(...reposOnPage)

    // If we hit the limit of 1000 repos, we need to use a more sophisticated approach
    if (reposOnPage.length === 1000) {
      console.log('Found 1000 repositories, which is the limit. Fetching additional repositories using GraphQL...')
      await fetchRemainingRepositories(repositories, organization)
    }

    console.log(`Found ${repositories.length} repositories in the ${organization} organization`)
    return repositories
  } catch (error) {
    console.error(`Error fetching repositories for ${organization}:`, error)
    throw new Error(`Failed to fetch repositories for ${organization}`)
  }
}
/**
 * Fetches additional repositories using the GitHub GraphQL API with cursor-based pagination
 * This is used when we have more than 1000 repositories and need to paginate properly
 */
async function fetchRemainingRepositories(existingRepos: Repository[], organization: string): Promise<void> {
  // Get the last repo's name to use as an "after" cursor
  // This assumes repositories are ordered by name
  const lastRepoName = existingRepos.length > 0
    ? existingRepos[existingRepos.length - 1].name
    : ''

  try {
    // Use GraphQL to get repos after our cursor
    // GitHub's GraphQL API supports cursor-based pagination which is more reliable
    const query = `
      query($cursor: String) {
        organization(login: "${organization}") {
          repositories(first: 100, after: $cursor, orderBy: {field: NAME, direction: ASC}) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              name
              owner {
                login
              }
              url
            }
          }
        }
      }
    `

    let hasNextPage = true
    let cursor = `"${lastRepoName}"`

    while (hasNextPage) {
      console.log(`Fetching additional repositories after ${cursor}...`)
      const { stdout } = await execAsync(`gh api graphql -f query='${query}' -f cursor=${cursor}`)
      const result = JSON.parse(stdout)

      const repos = result.data.organization.repositories.nodes.map((node: any) => ({
        name: node.name,
        owner: node.owner,
        url: node.url,
      }))

      existingRepos.push(...repos)

      hasNextPage = result.data.organization.repositories.pageInfo.hasNextPage
      if (hasNextPage) {
        cursor = `"${result.data.organization.repositories.pageInfo.endCursor}"`
      }
    }
  } catch (error) {
    console.error(`Error fetching additional repositories for ${organization}:`, error)
    console.warn('Continuing with partial repository list')
  }
}

/**
 * Fetches a specific repository by owner and repo name using GitHub API
 */
async function getSpecificRepository(owner: string, repo: string): Promise<Repository> {
  try {
    console.log(`Fetching specific repository: ${owner}/${repo}...`)
    const { stdout } = await execAsync(`gh api repos/${owner}/${repo} --jq '{name: .name, owner: {login: .owner.login}, url: .html_url}'`)
    
    const repository: Repository = JSON.parse(stdout)
    console.log(`Successfully fetched repository: ${owner}/${repo}`)
    return repository
  } catch (error) {
    console.error(`Error fetching repository ${owner}/${repo}:`, error)
    throw new Error(`Failed to fetch repository ${owner}/${repo}`)
  }
}

/**
 * Fetches branches for a given repository using GitHub API
 */
async function getBranches(owner: string, repo: string, maxBranchesToFetch: number = 1000): Promise<Branch[]> {
  const branches: Branch[] = []
  
  try {
    const query = `
      query($owner: String!, $repo: String!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          refs(first: 100, refPrefix: "refs/heads/", after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              name
              target {
                oid
                commitUrl
              }
            }
          }
        }
      }
    `

    let hasNextPage = true
    let cursor = null

    while (hasNextPage && branches.length < maxBranchesToFetch) {
      const { stdout } = await execAsync(
        `gh api graphql -f query='${query}' -f owner='${owner}' -f repo='${repo}' ${cursor ? `-f cursor='${cursor}'` : ''}`
      )
      const result = JSON.parse(stdout)

      if (!result.data?.repository?.refs?.nodes) {
        break
      }

      const newBranches = result.data.repository.refs.nodes.map((node: any) => ({
        name: node.name,
        commit: {
          sha: node.target.oid,
          url: node.target.commitUrl
        }
      }))

      branches.push(...newBranches)

      hasNextPage = result.data.repository.refs.pageInfo.hasNextPage
      if (hasNextPage) {
        cursor = result.data.repository.refs.pageInfo.endCursor
      }

      // Brief pause to avoid rate limiting
      if (hasNextPage && branches.length < maxBranchesToFetch) {
        await new Promise(resolve => setTimeout(resolve, 300))
      }
    }

    return branches
  } catch (error) {
    if (error instanceof Error) {
      const errorMsg = error.message || ''
      if (errorMsg.includes('rate limit') || errorMsg.includes('API rate limit exceeded')) {
        console.error(`GitHub API rate limit exceeded while fetching branches for ${owner}/${repo}`)
      } else {
        console.error(`Error fetching branches for ${owner}/${repo}:`, error)
      }
    }
    return branches.length > 0 ? branches : []
  }
}

/**
 * Checks if a branch name matches the required pattern
 */
function matchesBranchPattern(branchName: string): { matches: boolean; username?: string } {
  // Pattern 1: "push-" followed by exactly 12 characters
  const pattern1 = /^push-[a-zA-Z0-9]{12}$/

  // Pattern 2: any string containing "/push-" followed by exactly 12 characters
  const pattern2 = /([^\/]+)\/push-[a-zA-Z0-9]{12}$/

  if (pattern1.test(branchName)) {
    return { matches: true }
  }

  const match = branchName.match(pattern2)
  if (match && match[1]) {
    return { matches: true, username: match[1] }
  }

  return { matches: false }
}
/**
 * Find all matching branches across all repositories
 */
/**
 * Fetches top N repositories by stars across GitHub
 */
async function getTopRepos(count: number): Promise<Repository[]> {
  try {
    console.log(`Fetching top ${count} repositories by stars...`)

    // Properly construct the search query
    const query = encodeURIComponent('stars:>1000')

    // Use the GitHub search API with correct parameters
    // The `/search/repositories` endpoint needs query parameters in the URL
    const { stdout } = await execAsync(
      `gh api /search/repositories?q=${query}&sort=stars&order=desc&per_page=${count}`,
    )

    const response = JSON.parse(stdout)

    if (!response.items || !Array.isArray(response.items)) {
      throw new Error('Invalid response format from GitHub API')
    }

    const repositories: Repository[] = response.items.map((repo: any) => ({
      name: repo.name,
      owner: {
        login: repo.owner.login,
      },
      url: repo.html_url,
      stars: repo.stargazers_count,
    }))

    console.log(`Found top ${repositories.length} repositories by stars (out of ${response.total_count} total matches)`)

    return repositories
  } catch (error) {
    console.error('Error fetching top repositories:', error)
    if (error instanceof Error) {
      console.error('Error details:', error.message)
    }
    throw new Error('Failed to fetch top repositories')
  }
}

/**
 * Find all matching branches across repositories based on CLI options
 */
async function findMatchingBranches(options: CliOptions): Promise<BranchMatch[]> {
  const matches: BranchMatch[] = []
  let repositories: Repository[] = []
  let processedRepos = 0

  try {
    if (options.topRepos && options.topRepos > 0) {
      repositories = await getTopRepos(options.topRepos)
    } else {
      const organizations = options.orgs.split(',').map(org => org.trim())
      
      // Check if zen-browser-flake is in the list of organizations
      // This handles formats like "org1,MarceColl/zen-browser-flake,org2"
      const zenBrowserFlakePattern = /([^\/]+)\/zen-browser-flake/
      const orgsToProcess = []
      
      for (const org of organizations) {
        const match = org.match(zenBrowserFlakePattern)
        if (match) {
          try {
            // If it matches the pattern, fetch the specific repository
            const zenRepo = await getSpecificRepository(match[1], "zen-browser-flake")
            repositories.push(zenRepo)
            console.log(`Added zen-browser-flake repository to the list`)
          } catch (error) {
            console.error(`Failed to add zen-browser-flake repository:`, error)
          }
        } else {
          // Regular organization processing
          orgsToProcess.push(org)
        }
      }
      
      // Process regular organizations
      for (const org of orgsToProcess) {
        const orgRepos = await getRepositories(org)
        repositories.push(...orgRepos)
      }
    }

    for (const repo of repositories) {
      try {
        const branches = await getBranches(repo.owner.login, repo.name, options.maxBranches)
        let matchFound = false
        
        for (const branch of branches) {
          const { matches: isMatch, username } = matchesBranchPattern(branch.name)
          if (isMatch) {
            matchFound = true
            matches.push({
              repository: `${repo.owner.login}/${repo.name}`,
              branch: branch.name,
              username,
            })
          }
        }
        
        processedRepos++
        if (!matchFound) {
          const repoLimitInfo = options.maxRepos 
            ? `${processedRepos}/${Math.min(options.maxRepos, repositories.length)} (limit: ${options.maxRepos} of ${repositories.length} total)`
            : `${processedRepos}/${repositories.length}`;
          process.stdout.write(`\rProcessed ${repoLimitInfo} repositories...`)
        }
        
        // Check if we've reached the maxRepos limit
        // Check if we've reached the maxRepos limit
        if (options.maxRepos && processedRepos >= options.maxRepos) {
          console.log(`\nReached maximum repository limit (${options.maxRepos} of ${repositories.length} total). Stopping search.`)
        }
      } catch (error) {
        console.error(`Error processing repository ${repo.owner.login}/${repo.name}`)
        processedRepos++
        
        // Also check after processing a repo with error
        if (options.maxRepos && processedRepos >= options.maxRepos) {
          console.log(`\nReached maximum repository limit (${options.maxRepos} of ${repositories.length} total). Stopping search.`)
          break
        }
      }
    }
    process.stdout.write('\n')
    return matches
  } catch (error) {
    console.error('Error finding matching branches:', error)
    throw error
  }
}
/**
 * Main execution function
 */
async function main() {
  try {
    const options: CliOptions = {
      orgs: argv.orgs as string,
      topRepos: argv['top-repos'] as number | undefined,
      maxBranches: argv['max-branches'] as number,
      maxRepos: argv['max-repos'] as number | undefined,
    }

    const matchingBranches = await findMatchingBranches(options)

    if (matchingBranches.length === 0) {
      console.log('No matching branches found.')
      return
    }

    // Group branches by repository
    const repoMap = new Map<string, BranchMatch[]>()
    matchingBranches.forEach(match => {
      if (!repoMap.has(match.repository)) {
        repoMap.set(match.repository, [])
      }
      repoMap.get(match.repository)!.push(match)
    })

    console.log('\nRepositories with matching branches:')
    repoMap.forEach((branches, repository) => {
      console.log(`\n${repository}: ${branches.length} matching branches`)
      
      // Group branches by username
      const userBranches = new Map<string, number>()
      branches.forEach(branch => {
        const username = branch.username || 'unknown'
        userBranches.set(username, (userBranches.get(username) || 0) + 1)
      })

      // Display user statistics
      const userStats = Array.from(userBranches.entries())
        .sort(([, a], [, b]) => b - a)
        .map(([username, count]) => `  ${username}: ${count} branch${count > 1 ? 'es' : ''}`)
      console.log(userStats.join('\n'))
    })

    const repoCountInfo = options.maxRepos && processedRepos >= options.maxRepos 
      ? `${repoMap.size} repositories (limited to first ${options.maxRepos} of ${repositories.length} total)`
      : `${repoMap.size} repositories`;
    console.log(`\nTotal: ${matchingBranches.length} matching branches in ${repoCountInfo}`)
  } catch (error) {
    console.error('Failed to complete branch search:', error)
    process.exit(1)
  }
}

// Execute the main function
main().catch(error => {
  console.error('Unhandled error:', error)
  process.exit(1)
})
