# Finder of Jujutsu branches in GitHub repositories

Finds GitHub repositories with branches matching the pattern "push-".
It can scan across organizations or top repositories.

## How to run

```bash
GITHUB_TOKEN=$(gh auth token) pnpm --silent start --owner jj-vcs --repo MarceColl/zen-browser-flake
```
