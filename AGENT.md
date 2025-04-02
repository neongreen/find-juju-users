# Agent instructions

## Project Overview

This project is built in a Node.js/TypeScript environment, designed to search for GitHub repositories with branches that match the pattern "push-" (Jujutsu branches). The tool can scan across organizations or top repositories.

## Project Structure

- `package.json`: Node.js project configuration and dependencies
- `tsconfig.json`: TypeScript compiler configuration
- `src/index.ts`: Main application entry point and core logic
- `src/github.ts`: GitHub API interaction functions
- `tests/`: Contains test files for the codebase
- `.dprint.jsonc`: Code formatting configuration
- `mise.toml` & `mise.lock`: Runtime environment and dependency management

## Dependencies

- **Core Dependencies**
  - TypeScript: Static typing and modern JavaScript features
  - yargs: Command-line argument parsing
  - @octokit/rest: GitHub API client
- **Development Dependencies**
  - vitest: Testing framework for running tests
- **External Tools**
  - GitHub CLI (gh): Required for API authentication and repository access. The application will automatically try to get a token using `gh auth token` if no `GITHUB_TOKEN` environment variable is set.

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
npm start -- --orgs org1,org2

# Scan the zen-browser-flake repository
npm start -- --orgs MarceColl/zen-browser-flake

# Default behavior: Scans the authenticated user's accessible repositories
npm start
```

### Options

- `--orgs`: Comma-separated list of organization names to scan (can include specific repositories in format `owner/zen-browser-flake`)
- `--top-repos`: Number of top repositories to scan
- `--max-branches`: Maximum number of branches to scan per repository (default: 1000)
  If no options are specified, the tool will default to scanning the authenticated user's accessible repositories.

## Testing

This project uses Vitest for testing. Tests are located in the `tests/` directory.

### Running Tests

```bash
# Run tests once
pnpm test

# Run tests in watch mode during development
pnpm test:watch
```

### Test Environment

- Tests for GitHub API functions make real API calls
- Authentication for tests is handled in two ways:
  1. Using the GITHUB_TOKEN environment variable if available
  2. Using the GitHub CLI (`gh auth token`) if installed and authenticated
- Tests will be skipped with detailed error messages if no authentication is available
- Tests include timeouts to accommodate API latency

### Authentication

The application will try to authenticate with GitHub in the following order:

1. Using the GITHUB_TOKEN environment variable if available
2. Using the GitHub CLI by running `gh auth token`

If neither method works, appropriate error messages will be displayed, and the application will run with restricted API rate limits.

#### Authentication Troubleshooting

If you encounter authentication issues:

1. **GitHub CLI Not Installed**: Install GitHub CLI using the appropriate method for your OS
   ```
   # macOS
   brew install gh

   # Windows
   winget install -e --id GitHub.cli

   # Ubuntu/Debian
   sudo apt install gh
   ```

2. **Not Authenticated with GitHub CLI**: Run the following command to authenticate
   ```
   gh auth login
   ```

3. **Manual Token Setup**: You can create a personal access token at https://github.com/settings/tokens and set it as an environment variable
   ```
   export GITHUB_TOKEN=your_token_here
   ```

The application's token handling is designed to be seamless and require minimal user intervention while providing clear error messages when issues occur.
