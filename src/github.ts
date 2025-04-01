import { Octokit } from '@octokit/rest'
import {
  cacheBranches,
  CacheData,
  cacheOwnerRepositories,
  cachePullRequests,
  cacheTopRepositories,
  isCacheValid,
  loadCache,
  saveCache,
  saveOwnerType,
} from './cache.js'
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
// Cache instance
let cacheInstance: CacheData | null = null

/**
 * Get the cache instance, loading it from disk if needed
 * @param forceRefresh If true, ignore the existing cache and start fresh
 */
export async function getCache(forceRefresh = false): Promise<CacheData> {
  if (cacheInstance === null || forceRefresh) {
    cacheInstance = await loadCache(forceRefresh)
  }
  return cacheInstance
}

/**
 * Commit current cache to disk
 */
export async function persistCache(): Promise<void> {
  if (cacheInstance) {
    await saveCache(cacheInstance)
  }
}

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
 * Checks if the provided owner is an organization or a user
 * @param owner The GitHub owner (organization or user) to check
 * @returns Boolean indicating if the owner is an organization
 */
export async function isOrganization(owner: string): Promise<boolean> {
  // Check cache first
  const cache = await getCache()

  // Look for any repository from this owner to determine owner type
  const ownerRepos = Object.keys(cache.repositories)
    .filter(key => key.startsWith(`${owner}/`))
    .map(key => cache.repositories[key])

  // If we have cached owner information, use it
  if (ownerRepos.length > 0 && ownerRepos[0].ownerType) {
    return ownerRepos[0].ownerType === 'organization'
  }

  // Otherwise make API call
  const octokit = await getOctokit()

  try {
    // Try to get the organization profile
    await octokit.orgs.get({
      org: owner,
    })

    // If no error is thrown, it's an organization
    // Update cache
    cacheInstance = saveOwnerType(cache, owner, true)
    await persistCache()

    return true
  } catch (error) {
    // If we get a 404, it's not an organization, so it's likely a user
    if (error instanceof Error && error.message.includes('Not Found')) {
      // Update cache
      cacheInstance = saveOwnerType(cache, owner, false)
      await persistCache()

      return false
    }
    // For any other error, re-throw it
    throw error
  }
}

/**
 * Fetches repositories from the owner (organization or user) using GitHub API
 */
export async function getRepositories(owner: string): Promise<Repository[]> {
  // Check if we have this in cache
  const cache = await getCache()

  if (
    cache.ownerRepos
    && cache.ownerRepos[owner]
  ) {
    console.log(`Using cached repositories for ${owner} (${cache.ownerRepos[owner].data.length} repos)`)
    return cache.ownerRepos[owner].data
  }

  // Not in cache or cache expired, fetch from API
  const octokit = await getOctokit()

  try {
    // Check if the owner is an organization or a user
    const isOrg = await isOrganization(owner)

    console.log(`Fetching repositories from ${owner} ${isOrg ? 'organization' : 'user'}...`)

    let repos

    if (isOrg) {
      // Use Octokit's automatic pagination to get all repositories from an organization
      repos = await octokit.paginate(octokit.repos.listForOrg, {
        org: owner,
        per_page: 100,
        sort: 'full_name',
      })
    } else {
      // Use Octokit's automatic pagination to get all repositories from a user
      repos = await octokit.paginate(octokit.repos.listForUser, {
        username: owner,
        per_page: 100,
        sort: 'full_name',
      })
    }

    const repositories: Repository[] = repos.map(repo => ({
      name: repo.name,
      owner: {
        login: repo.owner.login,
      },
      url: repo.html_url,
    }))

    console.log(`Found ${repositories.length} repositories for ${owner} ${isOrg ? 'organization' : 'user'}`)

    // Update cache
    cacheInstance = cacheOwnerRepositories(cache, owner, repositories)
    await persistCache()

    return repositories
  } catch (error) {
    console.error(`Error fetching repositories for ${owner}:`, error)
    if (error instanceof Error) {
      console.error('Error details:', error.message)
    }
    throw new Error(`Failed to fetch repositories for ${owner}`)
  }
}

/**
 * Fetches a specific repository by owner and repo name using GitHub API
 */
export async function getSpecificRepository(owner: string, repo: string): Promise<Repository> {
  const cache = await getCache()
  const repoKey = `${owner}/${repo}`

  // Check if we have this repository in cache
  if (
    cache.repositories[repoKey]
    && cache.repositories[repoKey].data
  ) {
    console.log(`Using cached repository data for ${repoKey}`)
    return cache.repositories[repoKey].data
  }

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

    // Update cache
    if (!cache.repositories[repoKey]) {
      cache.repositories[repoKey] = {
        data: repository,
        processed: false,
      }
      cacheInstance = cache
      await persistCache()
    }

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
  const cache = await getCache()

  // Check if we have this in cache with the same count
  if (
    cache.topRepos
    && cache.topRepos.count === count
    && cache.topRepos.data.length === count
  ) {
    console.log(`Using cached top ${count} repositories`)
    return cache.topRepos.data
  }

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

    const result = repositories.slice(0, count)

    // Update cache
    cacheInstance = cacheTopRepositories(cache, count, result)
    await persistCache()

    return result
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
  const cache = await getCache()
  const repoKey = `${owner}/${repo}`

  // Check cache
  if (
    cache.repositories[repoKey]
    && cache.repositories[repoKey].branches
  ) {
    console.log(`Using cached branches for ${repoKey} (${cache.repositories[repoKey].branches!.length} branches)`)
    return cache.repositories[repoKey].branches!
  }

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
    const result = branches.slice(0, maxBranchesToFetch)

    // Update cache
    cacheInstance = cacheBranches(cache, owner, repo, result)
    await persistCache()

    return result
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
  const cache = await getCache()
  const repoKey = `${owner}/${repo}`

  // Check cache
  if (
    cache.repositories[repoKey]
    && cache.repositories[repoKey].pullRequests
  ) {
    console.log(`Using cached pull requests for ${repoKey} (${cache.repositories[repoKey].pullRequests!.length} PRs)`)
    return cache.repositories[repoKey].pullRequests!
  }

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
    const result = pullRequests.slice(0, maxPrs)

    // Update cache
    cacheInstance = cachePullRequests(cache, owner, repo, result)
    await persistCache()

    return result
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
