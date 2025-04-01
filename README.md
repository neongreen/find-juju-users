# Finder of Jujutsu branches in GitHub repositories

Finds GitHub repositories with branches and pull requests matching the pattern "push-".
It can scan across organizations or top repositories.

## How to run

```bash
# Basic usage (branches only)
GITHUB_TOKEN=$(gh auth token) pnpm --silent start --owner jj-vcs --repo MarceColl/zen-browser-flake

# Include pull requests in the search
GITHUB_TOKEN=$(gh auth token) pnpm --silent start --owner jj-vcs --include-prs

# Customize pull request search
GITHUB_TOKEN=$(gh auth token) pnpm --silent start --owner jj-vcs --include-prs --pr-status open --max-prs 50
```

## Options

### Repository Selection
- `--owner`: GitHub organization or user to process (can be used multiple times)
- `--repo`: Specific repository to process in format "owner/repo" (can be used multiple times)
- `--top-repos`: Number of top repositories by stars to process

### Branch Search Options
- `--max-branches`: Maximum number of branches to fetch per repository (default: 1000)
- `--max-repos`: Maximum number of repositories to process in total

### Pull Request Options
- `--include-prs`: Include pull requests in the search (default: false)
- `--pr-status`: Status of pull requests to include: 'open', 'closed', or 'all' (default: 'all')
- `--max-prs`: Maximum number of pull requests to fetch per repository (default: 100)

## Authentication

The tool requires a GitHub token for API access. You can provide it via the GITHUB_TOKEN environment variable.
```bash
GITHUB_TOKEN=$(gh auth token) pnpm --silent start [options]
```
