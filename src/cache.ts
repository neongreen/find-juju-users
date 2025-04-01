import fs from 'fs/promises'
import path from 'path'
import type { CliOptions } from './cli.js'
import type { Branch, PullRequest, Repository } from './github.js'

// Cache file location
const CACHE_DIR = '.cache'
const CACHE_FILE = 'find-juju-cache.json'

// Cache structure
export interface CacheData {
  cliOptions: CliOptions
  timestamp: number
  repositories: {
    [repoKey: string]: { // in format owner/repo
      ownerType?: 'organization' | 'user'
      data: Repository
      branches?: Branch[]
      branchesTimestamp?: number
      pullRequests?: PullRequest[]
      pullRequestsTimestamp?: number
      processed: boolean // track whether we've processed this repository
    }
  }
  topRepos?: {
    count: number
    data: Repository[]
    timestamp: number
  }
  ownerRepos?: {
    [owner: string]: {
      data: Repository[]
      timestamp: number
    }
  }
}

// Initialize empty cache
export const initializeCache = (): CacheData => {
  return {
    cliOptions: {
      owners: [],
      repos: [],
      maxBranches: 1000,
      includePrs: false,
      maxPrs: 100,
      prStatus: 'all',
    },
    timestamp: Date.now(),
    repositories: {},
  }
}

// Create cache directory if it doesn't exist
const ensureCacheDir = async (): Promise<void> => {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true })
  } catch (error) {
    console.error('Error creating cache directory:', error)
  }
}

// Load cache from file
export const loadCache = async (forceRefresh = false): Promise<CacheData> => {
  // If forceRefresh is true, return a fresh cache
  if (forceRefresh) {
    console.log('Force refresh requested. Starting with a fresh cache.')
    return initializeCache()
  }

  try {
    await ensureCacheDir()
    const cachePath = path.join(CACHE_DIR, CACHE_FILE)
    const data = await fs.readFile(cachePath, 'utf-8')
    console.log('Loaded cache from disk. Use --force-refresh to ignore cache.')
    return JSON.parse(data) as CacheData
  } catch (error) {
    // If file doesn't exist or has invalid JSON, return a new cache
    console.log('No valid cache found. Starting fresh.')
    return initializeCache()
  }
}

// Save cache to file
export const saveCache = async (cache: CacheData): Promise<void> => {
  try {
    await ensureCacheDir()
    const cachePath = path.join(CACHE_DIR, CACHE_FILE)
    await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf-8')
  } catch (error) {
    console.error('Error saving cache:', error)
  }
}

// Clear cache by removing the cache file
export const clearCache = async (): Promise<void> => {
  try {
    const cachePath = path.join(CACHE_DIR, CACHE_FILE)
    await fs.unlink(cachePath)
    console.log('Cache cleared successfully.')
  } catch (error) {
    // If file doesn't exist, that's fine
    if (error instanceof Error && (error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Error clearing cache:', error)
    }
  }
}

// Add/update specific owner's repositories in the cache
export const cacheOwnerRepositories = (
  cache: CacheData,
  owner: string,
  repositories: Repository[],
): CacheData => {
  const newCache = { ...cache }

  // Initialize owner repos if needed
  if (!newCache.ownerRepos) {
    newCache.ownerRepos = {}
  }

  // Add or update repos for this owner
  newCache.ownerRepos[owner] = {
    data: repositories,
    timestamp: Date.now(),
  }

  // Also add each repository to the main repositories map
  repositories.forEach(repo => {
    const repoKey = `${repo.owner.login}/${repo.name}`
    newCache.repositories[repoKey] = {
      ...newCache.repositories[repoKey],
      data: repo,
      processed: false,
    }
  })

  return newCache
}

// Cache top repositories
export const cacheTopRepositories = (
  cache: CacheData,
  count: number,
  repositories: Repository[],
): CacheData => {
  const newCache = { ...cache }

  newCache.topRepos = {
    count,
    data: repositories,
    timestamp: Date.now(),
  }

  // Also add each repository to the main repositories map
  repositories.forEach(repo => {
    const repoKey = `${repo.owner.login}/${repo.name}`
    newCache.repositories[repoKey] = {
      ...newCache.repositories[repoKey],
      data: repo,
      processed: false,
    }
  })

  return newCache
}

// Cache branches for a repository
export const cacheBranches = (
  cache: CacheData,
  owner: string,
  repo: string,
  branches: Branch[],
): CacheData => {
  const newCache = { ...cache }
  const repoKey = `${owner}/${repo}`

  if (!newCache.repositories[repoKey]) {
    newCache.repositories[repoKey] = {
      data: { name: repo, owner: { login: owner }, url: `https://github.com/${owner}/${repo}` },
      processed: false,
    }
  }

  newCache.repositories[repoKey].branches = branches
  newCache.repositories[repoKey].branchesTimestamp = Date.now()

  return newCache
}

// Cache pull requests for a repository
export const cachePullRequests = (
  cache: CacheData,
  owner: string,
  repo: string,
  pullRequests: PullRequest[],
): CacheData => {
  const newCache = { ...cache }
  const repoKey = `${owner}/${repo}`

  if (!newCache.repositories[repoKey]) {
    newCache.repositories[repoKey] = {
      data: { name: repo, owner: { login: owner }, url: `https://github.com/${owner}/${repo}` },
      processed: false,
    }
  }

  newCache.repositories[repoKey].pullRequests = pullRequests
  newCache.repositories[repoKey].pullRequestsTimestamp = Date.now()

  return newCache
}

// Mark a repository as processed
export const markRepositoryProcessed = (
  cache: CacheData,
  owner: string,
  repo: string,
): CacheData => {
  const newCache = { ...cache }
  const repoKey = `${owner}/${repo}`

  if (!newCache.repositories[repoKey]) {
    return newCache
  }

  newCache.repositories[repoKey].processed = true
  return newCache
}

// Save the owner type (organization or user)
export const saveOwnerType = (
  cache: CacheData,
  owner: string,
  isOrg: boolean,
): CacheData => {
  const newCache = { ...cache }

  // Update all repositories for this owner
  Object.keys(newCache.repositories).forEach(repoKey => {
    if (repoKey.startsWith(`${owner}/`)) {
      newCache.repositories[repoKey].ownerType = isOrg ? 'organization' : 'user'
    }
  })

  return newCache
}

// Check if cache is valid based on timestamp and TTL
// This function always returns true now (no TTL check) but we keep it for future flexibility
export const isCacheValid = (timestamp: number | undefined, ttlHours = 24): boolean => {
  if (!timestamp) return false

  // No longer using TTL - always return true if we have a timestamp
  return true
}

// Update CLI options in cache
export const updateCliOptions = (cache: CacheData, options: CliOptions): CacheData => {
  return {
    ...cache,
    cliOptions: options,
    timestamp: Date.now(),
  }
}
