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

export interface PullRequest {
  number: number
  title: string
  status: 'open' | 'closed'
  created_at: string
  head: {
    ref: string // The name of the branch the PR is from
    label: string
  }
  base: {
    ref: string // The name of the branch the PR is targeting
  }
  user: {
    login: string
  }
  html_url: string
}

interface RepoStats {
  repository: string
  totalBranches: number
  userStats: UserStats[]
}

// Cache the GitHub token so we only get it once
let cachedGithubToken: string | null = null

/**
 * Attempt to get a GitHub token from the GitHub CLI
 * @returns The GitHub token or null if it couldn't be retrieved
 */
async function getGitHubToken(): Promise<string | null> {
  if (cachedGithubToken !== null) {
    return cachedGithubToken
  }

  try {
    // Try to get the token from environment first
    const envToken = process.env.GITHUB_TOKEN
    if (envToken) {
      cachedGithubToken = envToken
      return envToken
    }

    // Try to get the token from GitHub CLI
    console.log('No GITHUB_TOKEN in environment, attempting to get token from GitHub CLI...')
    const { stdout, stderr } = await execAsync('gh auth token')

    if (stderr) {
      console.error('Error getting GitHub token from CLI:', stderr)
      return null
    }

    const token = stdout.trim()
    if (!token) {
      console.error('GitHub CLI returned an empty token. Please run "gh auth login" first.')
      return null
    }

    // Cache the token
    cachedGithubToken = token
    return token
  } catch (error) {
    console.error('Failed to get GitHub token:', error instanceof Error ? error.message : String(error))
    console.error('Make sure GitHub CLI is installed and you are authenticated.')
    console.error('Run "gh auth login" to authenticate or set the GITHUB_TOKEN environment variable.')
    return null
  }
}

/**
 * Initialize Octokit with GitHub token from environment or GitHub CLI
 */
async function getOctokit(): Promise<Octokit> {
  const token = await getGitHubToken()

  if (!token) {
    console.warn('No GitHub token available. API rate limits will be severely restricted.')
    console.warn('Certain operations may fail due to rate limiting.')
  }

  return new Octokit({
    auth: token,
  })
}

/**
 * Fetches repositories from the organization using GitHub API
 */
export async function getRepositories(organization: string): Promise<Repository[]> {
  const octokit = await getOctokit()

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
    const octokit = await getOctokit()
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
    const octokit = await getOctokit()

    const repositories: Repository[] = []
    let page = 1
    const perPage = 100

    while (repositories.length < count) {
      const response = await octokit.search.repos({
        q: 'stars:>1000',
        sort: 'stars',
        order: 'desc',
        per_page: perPage,
        page,
      })

      const repos = response.data.items.map(repo => ({
        name: repo.name,
        owner: {
          login: repo.owner.login,
        },
        url: repo.html_url,
        stars: repo.stargazers_count,
      }))

      repositories.push(...repos)

      if (repos.length < perPage) {
        // No more results to fetch
        break
      }

      page++
    }

    console.log(
      `Found top ${repositories.length} repositories by stars (out of ${
        Math.min(count, repositories.length)
      } requested)`,
    )

    return repositories.slice(0, count)
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
  const octokit = await getOctokit()

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

/**
 * Fetches pull requests for a given repository using GitHub API
 */
export async function getPullRequests(
  owner: string,
  repo: string,
  maxPrs: number = 100,
  prStatus: 'open' | 'closed' | 'all' = 'all',
): Promise<PullRequest[]> {
  const octokit = await getOctokit()

  try {
    console.log(`Fetching pull requests for ${owner}/${repo}...`)

    const pullRequests = await octokit.paginate(
      octokit.pulls.list,
      {
        owner,
        repo,
        state: prStatus,
        sort: 'created', // Sort by creation date
        direction: 'desc', // Newest first
        per_page: 100,
      },
      response =>
        response.data.map(pr => ({
          number: pr.number,
          title: pr.title,
          status: pr.state as 'open' | 'closed',
          created_at: pr.created_at,
          head: {
            ref: pr.head.ref,
            label: pr.head.label,
          },
          base: {
            ref: pr.base.ref,
          },
          user: {
            login: pr.user?.login || 'unknown',
          },
          html_url: pr.html_url,
        })),
      {
        throttle: {
          onRateLimit: (retryAfter, options) => {
            console.warn(`Rate limit hit while fetching PRs. Retrying after ${retryAfter} seconds`)
            return true // retry
          },
          onSecondaryRateLimit: (retryAfter, options) => {
            console.warn(`Secondary rate limit hit while fetching PRs. Retrying after ${retryAfter} seconds`)
            return true // retry
          },
        },
        // Stop once we've collected enough PRs
        pageOptions: {
          request: {
            pageLimit: Math.ceil(maxPrs / 100),
          },
        },
      },
    )

    console.log(`Found ${pullRequests.length} pull requests for ${owner}/${repo}`)

    // If we collected more PRs than the max, truncate the array
    return pullRequests.slice(0, maxPrs)
  } catch (error) {
    if (error instanceof Error) {
      const errorMsg = error.message || ''
      if (errorMsg.includes('rate limit') || errorMsg.includes('API rate limit exceeded')) {
        console.error(`GitHub API rate limit exceeded while fetching PRs for ${owner}/${repo}`)
      } else {
        console.error(`Error fetching PRs for ${owner}/${repo}:`, error)
      }
    }
    return []
  }
}
