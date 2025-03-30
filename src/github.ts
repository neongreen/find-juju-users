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

/**
 * Fetches repositories from the jj-vcs organization using GitHub CLI
 */
export async function getRepositories(organization: string): Promise<Repository[]> {
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
export async function fetchRemainingRepositories(existingRepos: Repository[], organization: string): Promise<void> {
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
export async function getSpecificRepository(owner: string, repo: string): Promise<Repository> {
  try {
    console.log(`Fetching specific repository: ${owner}/${repo}...`)
    const { stdout } = await execAsync(
      `gh api repos/${owner}/${repo} --jq '{name: .name, owner: {login: .owner.login}, url: .html_url}'`,
    )

    const repository: Repository = JSON.parse(stdout)
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
        `gh api graphql -f query='${query}' -f owner='${owner}' -f repo='${repo}' ${
          cursor ? `-f cursor='${cursor}'` : ''
        }`,
      )
      const result = JSON.parse(stdout)

      if (!result.data?.repository?.refs?.nodes) {
        break
      }

      const newBranches = result.data.repository.refs.nodes.map((node: any) => ({
        name: node.name,
        commit: {
          sha: node.target.oid,
          url: node.target.commitUrl,
        },
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
