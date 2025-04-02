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
- Specific Repository Support: Ability to scan specific repositories
- Customizable Scan Limits: Control the scope of scanning with repository limits

For usage instructions, please refer to README.md which contains the latest documentation.

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
