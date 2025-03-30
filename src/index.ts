import { exec } from 'child_process'
import { promisify } from 'util'
import { CliOptions, getCliOptions } from './cli.js'
import {
  Branch,
  getBranches,
  getRepositories,
  getSpecificRepository,
  getTopRepos,
  parseRepoString,
  Repository,
} from './github.js'

export const execAsync = promisify(exec)

interface BranchMatch {
  repository: string
  branch: string
  username?: string // Extracted username from branch pattern
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
            ? `${processedRepos}/${
              Math.min(options.maxRepos, repositories.length)
            } (limit: ${options.maxRepos} of ${repositories.length} total)`
            : `${processedRepos}/${repositories.length}`
          process.stdout.write(`\rProcessed ${repoLimitInfo} repositories...`)
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

        // Also check after processing a repo with error
        if (options.maxRepos && processedRepos >= options.maxRepos) {
          console.log(
            `\nReached maximum repository limit (${options.maxRepos} of ${repositories.length} total). Stopping search.`,
          )
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
    const options = getCliOptions()

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
