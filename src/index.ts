import { exec } from 'child_process'
import { promisify } from 'util'
import { clearCache, markRepositoryBranchesProcessed, markRepositoryPRsProcessed, updateCliOptions } from './cache.js'
import { CliOptions, getCliOptions } from './cli.js'
import {
  Branch,
  getBranches,
  getCache,
  getPullRequests,
  getRepositories,
  getSpecificRepository,
  getTopRepos,
  parseRepoString,
  persistCache,
  Repository,
} from './github.js'

export const execAsync = promisify(exec)

interface BranchMatch {
  repository: string
  branch: string
  username?: string // Extracted username from branch pattern
}

interface PullRequestMatch {
  repository: string
  prNumber: number
  title: string
  status: 'open' | 'closed'
  username: string
  branchName: string
  createdAt: string
  url: string
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
 * Find all matching branches across repositories based on CLI options
 */
async function findMatchingBranches(options: CliOptions): Promise<BranchMatch[]> {
  const matches: BranchMatch[] = []
  let repositories: Repository[] = []
  let processedRepos = 0
  let cache = await getCache(options.forceRefresh)

  try {
    // Process top repositories by stars if specified
    if (options.topRepos && options.topRepos > 0) {
      const topRepos = await getTopRepos(options.topRepos)
      repositories.push(...topRepos)
    }

    // Process owner organizations/users
    if (options.owners.length > 0) {
      for (const owner of options.owners) {
        const ownerRepos = await getRepositories(owner)
        repositories.push(...ownerRepos)
      }
    }

    // Process specific repositories
    if (options.repos.length > 0) {
      for (const repoString of options.repos) {
        const { owner, repo } = parseRepoString(repoString)
        try {
          const specificRepo = await getSpecificRepository(owner, repo)
          repositories.push(specificRepo)
        } catch (error) {
          console.error(`Failed to add repository ${repoString}:`, error)
        }
      }
    }

    console.log(`Found ${repositories.length} repositories to process`)

    // First, process all repositories (both cached and uncached)
    // to get matches from all data we have
    for (const repo of repositories) {
      const repoKey = `${repo.owner.login}/${repo.name}`

      // If we have cached branches for this repo, use them for matching
      if (cache.repositories[repoKey]?.branches) {
        const branches = cache.repositories[repoKey].branches!

        for (const branch of branches) {
          const { matches: isMatch, username } = matchesBranchPattern(branch.name)
          if (isMatch) {
            matches.push({
              repository: `${repo.owner.login}/${repo.name}`,
              branch: branch.name,
              username,
            })
          }
        }
      }
    }

    // Now filter repositories that don't have branches processed yet, so we only fetch branch data for these
    const unprocessedRepos = repositories.filter(repo => {
      const repoKey = `${repo.owner.login}/${repo.name}`
      return !cache.repositories[repoKey]?.branchesProcessed
    })

    if (unprocessedRepos.length < repositories.length) {
      console.log(
        `Resuming search: ${
          repositories.length - unprocessedRepos.length
        } repositories already processed, ${unprocessedRepos.length} remaining.`,
      )
      processedRepos = repositories.length - unprocessedRepos.length
    } else {
      console.log(`Starting search on ${repositories.length} repositories.`)
    }

    for (const repo of unprocessedRepos) {
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
            ? `${processedRepos}/${
              Math.min(options.maxRepos, repositories.length)
            } (limit: ${options.maxRepos} of ${repositories.length} total)`
            : `${processedRepos}/${repositories.length}`
          process.stdout.write(`\rProcessed ${repoLimitInfo} repositories...`)
        }

        // Mark repository as having its branches processed in cache
        cache = markRepositoryBranchesProcessed(cache, repo.owner.login, repo.name)

        // Save cache every 5 repositories to allow for resumption
        if (processedRepos % 5 === 0) {
          await persistCache()
        }

        // Check if we've reached the maxRepos limit
        if (options.maxRepos && processedRepos >= options.maxRepos) {
          console.log(
            `\nReached maximum repository limit (${options.maxRepos} of ${repositories.length} total). Stopping search.`,
          )
          break
        }
      } catch (error) {
        console.error(`Error processing repository ${repo.owner.login}/${repo.name}`)
        processedRepos++

        // Even if processing failed, mark as having branches processed to prevent re-processing on resume
        cache = markRepositoryBranchesProcessed(cache, repo.owner.login, repo.name)

        // Save cache periodically
        if (processedRepos % 5 === 0) {
          await persistCache()
        }

        // Also check after processing a repo with error
        if (options.maxRepos && processedRepos >= options.maxRepos) {
          console.log(
            `\nReached maximum repository limit (${options.maxRepos} of ${repositories.length} total). Stopping search.`,
          )
          break
        }
      }
    }

    // Final cache update
    await persistCache()

    process.stdout.write('\n')
    return matches
  } catch (error) {
    console.error('Error finding matching branches:', error)
    throw error
  }
}

async function findMatchingPullRequests(options: CliOptions, repositories: Repository[]): Promise<PullRequestMatch[]> {
  const matches: PullRequestMatch[] = []
  let processedRepos = 0
  let cache = await getCache(options.forceRefresh)

  try {
    // First, process all repositories (both cached and uncached)
    // to get matches from all data we have
    for (const repo of repositories) {
      const repoKey = `${repo.owner.login}/${repo.name}`

      // If we have cached PRs for this repo, use them for matching
      if (cache.repositories[repoKey]?.pullRequests) {
        const pullRequests = cache.repositories[repoKey].pullRequests!

        for (const pr of pullRequests) {
          const { matches: isMatch, username } = matchesBranchPattern(pr.head.ref)
          if (isMatch) {
            matches.push({
              repository: `${repo.owner.login}/${repo.name}`,
              prNumber: pr.number,
              title: pr.title,
              status: pr.status,
              username: username || pr.user.login,
              branchName: pr.head.ref,
              createdAt: pr.created_at,
              url: pr.html_url,
            })
          }
        }
      }
    }

    // Filter out repositories that already have PRs processed
    const unprocessedRepos = repositories.filter(repo => {
      const repoKey = `${repo.owner.login}/${repo.name}`
      return !cache.repositories[repoKey]?.prsProcessed
    })

    if (unprocessedRepos.length < repositories.length) {
      console.log(
        `Resuming PR search: ${
          repositories.length - unprocessedRepos.length
        } repositories already processed, ${unprocessedRepos.length} remaining.`,
      )
      processedRepos = repositories.length - unprocessedRepos.length
    } else {
      console.log(`Starting PR search on ${repositories.length} repositories.`)
    }

    for (const repo of unprocessedRepos) {
      try {
        const pullRequests = await getPullRequests(
          repo.owner.login,
          repo.name,
          options.maxPrs,
          options.prStatus,
        )

        let matchFound = false
        for (const pr of pullRequests) {
          const { matches: isMatch, username } = matchesBranchPattern(pr.head.ref)
          if (isMatch) {
            matchFound = true
            matches.push({
              repository: `${repo.owner.login}/${repo.name}`,
              prNumber: pr.number,
              title: pr.title,
              status: pr.status,
              username: username || pr.user.login,
              branchName: pr.head.ref,
              createdAt: pr.created_at,
              url: pr.html_url,
            })
          }
        }

        processedRepos++
        if (!matchFound) {
          const repoLimitInfo = options.maxRepos
            ? `${processedRepos}/${
              Math.min(options.maxRepos, repositories.length)
            } (limit: ${options.maxRepos} of ${repositories.length} total)`
            : `${processedRepos}/${repositories.length}`
          process.stdout.write(`\rProcessed PR search in ${repoLimitInfo} repositories...`)
        }

        // Mark this repository as having its PRs processed in the cache
        cache = markRepositoryPRsProcessed(cache, repo.owner.login, repo.name)

        // Save cache every 5 repositories to allow for resumption
        if (processedRepos % 5 === 0) {
          await persistCache()
        }

        // Check if we've reached the maxRepos limit
        if (options.maxRepos && processedRepos >= options.maxRepos) {
          console.log(
            `\nReached maximum repository limit (${options.maxRepos} of ${repositories.length} total). Stopping PR search.`,
          )
          break
        }
      } catch (error) {
        console.error(`Error processing pull requests for repository ${repo.owner.login}/${repo.name}`)
        processedRepos++

        // Even on error, mark as having PRs processed to avoid retries
        cache = markRepositoryPRsProcessed(cache, repo.owner.login, repo.name)

        // Save cache periodically
        if (processedRepos % 5 === 0) {
          await persistCache()
        }

        // Also check after processing a repo with error
        if (options.maxRepos && processedRepos >= options.maxRepos) {
          console.log(
            `\nReached maximum repository limit (${options.maxRepos} of ${repositories.length} total). Stopping PR search.`,
          )
          break
        }
      }
    }

    // Final cache update
    await persistCache()

    process.stdout.write('\n')
    return matches
  } catch (error) {
    console.error('Error finding matching pull requests:', error)
    throw error
  }
}

/**
 * Main execution function
 */
async function main() {
  try {
    const options = getCliOptions()

    // Handle cache clearing if requested
    if (options.clearCache) {
      await clearCache()
    }

    let cache = await getCache(options.forceRefresh)

    // Update cache with CLI options
    cache = updateCliOptions(cache, options)
    await persistCache()

    // Gather repositories first as we'll need them for both branches and PRs
    let repositories: Repository[] = []

    // Process top repositories by stars if specified
    if (options.topRepos && options.topRepos > 0) {
      const topRepos = await getTopRepos(options.topRepos)
      repositories.push(...topRepos)
    }

    // Process owner organizations/users
    if (options.owners.length > 0) {
      for (const owner of options.owners) {
        const ownerRepos = await getRepositories(owner)
        repositories.push(...ownerRepos)
      }
    }

    // Process specific repositories
    if (options.repos.length > 0) {
      for (const repoString of options.repos) {
        const { owner, repo } = parseRepoString(repoString)
        try {
          const specificRepo = await getSpecificRepository(owner, repo)
          repositories.push(specificRepo)
        } catch (error) {
          console.error(`Failed to add repository ${repoString}:`, error)
        }
      }
    }

    console.log(`Found ${repositories.length} repositories to process`)

    // Cache checkpoint - save repositories list
    await persistCache()

    // Find matching branches
    const matchingBranches = await findMatchingBranches(options)

    // Cache checkpoint after finding branches
    await persistCache()

    let matchingPRs: PullRequestMatch[] = []

    // Find matching PRs if enabled
    if (options.includePrs) {
      matchingPRs = await findMatchingPullRequests(options, repositories)

      // Cache checkpoint after finding PRs
      await persistCache()
    }

    if (matchingBranches.length === 0 && matchingPRs.length === 0) {
      console.log('No matching branches or pull requests found.')
      return
    }

    // Group and display branch matches
    if (matchingBranches.length > 0) {
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
          const username = branch.username || '<no prefix>'
          userBranches.set(username, (userBranches.get(username) || 0) + 1)
        })

        // Display user statistics
        const userStats = Array.from(userBranches.entries())
          .sort(([, a], [, b]) => b - a)
          .map(([username, count]) => `  ${username}: ${count} branch${count > 1 ? 'es' : ''}`)
        console.log(userStats.join('\n'))
      })

      const repoCountInfo = options.maxRepos && repositories.length > options.maxRepos
        ? `${repoMap.size} repositories (limited to first ${options.maxRepos} of ${repositories.length} total)`
        : `${repoMap.size} repositories`
      console.log(`\nTotal: ${matchingBranches.length} matching branches in ${repoCountInfo}`)
    }

    // Group and display PR matches
    if (matchingPRs.length > 0) {
      // Group PRs by repository
      const prRepoMap = new Map<string, PullRequestMatch[]>()
      matchingPRs.forEach(match => {
        if (!prRepoMap.has(match.repository)) {
          prRepoMap.set(match.repository, [])
        }
        prRepoMap.get(match.repository)!.push(match)
      })

      console.log('\nRepositories with matching pull requests:')
      prRepoMap.forEach((prs, repository) => {
        console.log(`\n${repository}: ${prs.length} matching pull requests`)

        // Group PRs by username
        const userPRs = new Map<string, PullRequestMatch[]>()
        prs.forEach(pr => {
          if (!userPRs.has(pr.username)) {
            userPRs.set(pr.username, [])
          }
          userPRs.get(pr.username)!.push(pr)
        })

        // Display PR statistics by user
        Array.from(userPRs.entries())
          .sort(([, a], [, b]) => b.length - a.length)
          .forEach(([username, userPRs]) => {
            console.log(`\n  ${username}: ${userPRs.length} PR${userPRs.length > 1 ? 's' : ''}`)
            userPRs.forEach(pr => {
              console.log(`    #${pr.prNumber} [${pr.status}] ${pr.title} (${pr.branchName})`)
              console.log(`    Created: ${new Date(pr.createdAt).toLocaleDateString()}`)
              console.log(`    ${pr.url}`)
            })
          })
      })

      const prRepoCountInfo = options.maxRepos && repositories.length > options.maxRepos
        ? `${prRepoMap.size} repositories (limited to first ${options.maxRepos} of ${repositories.length} total)`
        : `${prRepoMap.size} repositories`
      console.log(`\nTotal: ${matchingPRs.length} matching pull requests in ${prRepoCountInfo}`)
    }
  } catch (error) {
    console.error('Failed to complete search:', error)
    process.exit(1)
  }
}

// Only run the main function when this file is executed directly (not imported)
// This check is to avoid running the main function during tests
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Unhandled error:', error)
    process.exit(1)
  })
}
