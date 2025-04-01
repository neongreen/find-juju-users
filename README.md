# Finder of Jujutsu branches in GitHub repositories

Finds GitHub repositories with branches and pull requests matching the pattern "push-".
It can scan across organizations or top repositories.

## How to run

```bash
# Basic usage (branches only)
pnpm --silent start --owner jj-vcs --repo MarceColl/zen-browser-flake

# Include pull requests in the search
pnpm --silent start --owner jj-vcs --include-prs

# Customize pull request search
pnpm --silent start --owner jj-vcs --include-prs --pr-status open --max-prs 50
```

## Options

### Repository Selection

- `--owner`: GitHub organization or user to process (can be used multiple times, automatically detects if owner is an org or user)
- `--repo`: Specific repository to process in format "owner/repo" (can be used multiple times)
- `--top-repos`: Number of top repositories by stars to process

### Branch Search Options

- `--max-branches`: Maximum number of branches to fetch per repository (default: 1000)
- `--max-repos`: Maximum number of repositories to process in total

### Pull Request Options

- `--include-prs`: Include pull requests in the search (default: false)
- `--pr-status`: Status of pull requests to include: 'open', 'closed', or 'all' (default: 'all')
- `--max-prs`: Maximum number of pull requests to fetch per repository (default: 100)

### Caching and Resume Options

- `--force-refresh`: Force refreshing data from GitHub, ignoring cache (default: false)
- `--clear-cache`: Clear the cache completely before running (default: false)

## Resumable Execution

The tool now supports resumable execution by caching API results and tracking progress.
If your search is interrupted (e.g., due to CTRL+C or connection issues), you can simply
restart the tool with the same parameters and it will pick up where it left off, using
cached data when possible.

The cache is stored in the `.cache` directory and includes:

- Repository lists from organizations and users
- Top repositories by stars
- Branch and PR information for each repository
- Processing status to track progress

Cache data is reused indefinitely to minimize API requests and enable resumable operation.
Use `--force-refresh` when you want to force a fresh search, ignoring the cache completely.

## Authentication

The tool requires a GitHub token for API access. You can provide it via the GITHUB_TOKEN environment variable.

```bash
GITHUB_TOKEN=$(gh auth token) pnpm --silent start [options]
```
