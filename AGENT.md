# Agent instructions

## Project Overview

This project is built in a Node.js/TypeScript environment, designed to search for GitHub repositories with branches that match the pattern "push-" (Jujutsu branches). The tool can scan across organizations or top repositories.

## Project Structure

- `package.json`: Node.js project configuration and dependencies
- `tsconfig.json`: TypeScript compiler configuration
- `src/index.ts`: Main application entry point and core logic
- `.dprint.jsonc`: Code formatting configuration
- `mise.toml` & `mise.lock`: Runtime environment and dependency management

## Dependencies

- **Core Dependencies**
  - TypeScript: Static typing and modern JavaScript features
  - yargs: Command-line argument parsing
- **External Tools**
  - GitHub CLI (gh): Required for API authentication and repository access

## Functionality Overview

- Organization Scanning: Ability to scan specified GitHub organizations
- Branch Pattern Matching: Identifies branches matching the "push-" pattern
- Statistics Output: Generates summary statistics of matching branches
- Rate Limit Handling: Manages GitHub API rate limits
- Error Management: Robust error handling for API and network issues
- Specific Repository Support: Ability to scan the zen-browser-flake repository specifically
- Customizable Scan Limits: Control the scope of scanning with repository and branch limits

## Usage Instructions

The tool can be run with different options to customize the search scope:

```bash
# Scan specific organizations
npm start -- --orgs org1,org2

# Scan top repositories
npm start -- --top-repos 100

# Scan with branch and repository limits
npm start -- --orgs org1,org2 --max-branches 500 --max-repos 50

# Scan the zen-browser-flake repository
npm start -- --orgs MarceColl/zen-browser-flake

# Default behavior: Scans the authenticated user's accessible repositories
npm start
```

### Options

- `--orgs`: Comma-separated list of organization names to scan (can include specific repositories in format `owner/zen-browser-flake`)
- `--top-repos`: Number of top repositories to scan
- `--max-branches`: Maximum number of branches to scan per repository (default: 1000)
- `--max-repos`: Maximum number of repositories to scan in total (optional)

If no options are specified, the tool will default to scanning the authenticated user's accessible repositories.
