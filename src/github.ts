import { Octokit } from '@octokit/rest'
import { Repository, UserStats } from './github.js'
import { execAsync } from './index.js'

export interface Repository {
  name: string
  owner: {
    login: string
  }
  url: string
  stars?: number
}

export interface Branch {
  name: string
  commit: {
    sha: string
    url: string
  }
}

export interface UserStats {
  username: string
  count: number
}

interface RepoStats {
  repository: string
  totalBranches: number
  userStats: UserStats[]
}

// Initialize Octokit with GitHub token from environment
function getOctokit() {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.warn('No GITHUB_TOKEN found in environment variables. API rate limits will be restricted.')
  }
  return new Octokit({
    auth: token,
  })
}

/**
 * Fetches repositories from the organization using GitHub API
 */
export async function getRepositories(organization: string): Promise<Repository[]> {
  const octokit = getOctokit()

  try {
    console.log(`Fetching repositories from ${organization} organization...`)

    // Use Octokit's automatic pagination to get all repositories at once
    const repos = await octokit.paginate(octokit.repos.listForOrg, {
      org: organization,
      per_page: 100,
      sort: 'full_name',
    })

    const repositories: Repository[] = repos.map(repo => ({
      name: repo.name,
      owner: {
        login: repo.owner.login,
      },
      url: repo.html_url,
    }))

    console.log(`Found ${repositories.length} repositories in the ${organization} organization`)
    return repositories
  } catch (error) {
    console.error(`Error fetching repositories for ${organization}:`, error)
    if (error instanceof Error) {
      console.error('Error details:', error.message)
    }
    throw new Error(`Failed to fetch repositories for ${organization}`)
  }
}

/**
 * Fetches a specific repository by owner and repo name using GitHub API
 */
export async function getSpecificRepository(owner: string, repo: string): Promise<Repository> {
  try {
    console.log(`Fetching specific repository: ${owner}/${repo}...`)
    const octokit = getOctokit()
    const response = await octokit.repos.get({
      owner,
      repo,
    })

    const repository: Repository = {
      name: response.data.name,
      owner: {
        login: response.data.owner.login,
      },
      url: response.data.html_url,
    }
    console.log(`Successfully fetched repository: ${owner}/${repo}`)
    return repository
  } catch (error) {
    console.error(`Error fetching repository ${owner}/${repo}:`, error)
    throw new Error(`Failed to fetch repository ${owner}/${repo}`)
  }
}

/**
 * Fetches top N repositories by stars across GitHub
 */
export async function getTopRepos(count: number): Promise<Repository[]> {
  try {
    console.log(`Fetching top ${count} repositories by stars...`)
    const octokit = getOctokit()

    const response = await octokit.search.repos({
      q: 'stars:>1000',
      sort: 'stars',
      order: 'desc',
      per_page: count,
    })

    const repositories: Repository[] = response.data.items.map(repo => ({
      name: repo.name,
      owner: {
        login: repo.owner.login,
      },
      url: repo.html_url,
      stars: repo.stargazers_count,
    }))

    console.log(
      `Found top ${repositories.length} repositories by stars (out of ${response.data.total_count} total matches)`,
    )

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
 * Parses a repository string in the format "owner/repo"
 * Returns an object with owner and repo properties
 */
export function parseRepoString(repoString: string): { owner: string; repo: string } {
  const [owner, repo] = repoString.split('/')
  return { owner, repo }
}

/**
 * Fetches branches for a given repository using GitHub API
 */
export async function getBranches(owner: string, repo: string, maxBranchesToFetch: number = 1000): Promise<Branch[]> {
  const octokit = getOctokit()

  try {
    console.log(`Fetching branches for ${owner}/${repo}...`)

    // Use Octokit's automatic pagination with a limit
    const branches = await octokit.paginate(
      octokit.repos.listBranches,
      {
        owner,
        repo,
        per_page: 100,
      },
      response =>
        response.data.map(branch => ({
          name: branch.name,
          commit: {
            sha: branch.commit.sha,
            url: branch.commit.url,
          },
        })),
      {
        throttle: {
          onRateLimit: (retryAfter, options) => {
            console.warn(`Rate limit hit while fetching branches. Retrying after ${retryAfter} seconds`)
            return true // retry
          },
          onSecondaryRateLimit: (retryAfter, options) => {
            console.warn(`Secondary rate limit hit while fetching branches. Retrying after ${retryAfter} seconds`)
            return true // retry
          },
        },
        // Stop once we've collected enough branches
        pageOptions: {
          request: {
            pageLimit: Math.ceil(maxBranchesToFetch / 100),
          },
        },
      },
    )

    console.log(`Found ${branches.length} branches for ${owner}/${repo}`)

    // If we collected more branches than the max, truncate the array
    return branches.slice(0, maxBranchesToFetch)
  } catch (error) {
    if (error instanceof Error) {
      const errorMsg = error.message || ''
      if (errorMsg.includes('rate limit') || errorMsg.includes('API rate limit exceeded')) {
        console.error(`GitHub API rate limit exceeded while fetching branches for ${owner}/${repo}`)
      } else {
        console.error(`Error fetching branches for ${owner}/${repo}:`, error)
      }
    }
    return []
  }
}
