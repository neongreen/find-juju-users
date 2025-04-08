# Finder of Jujutsu branches in GitHub repositories

Finds GitHub repositories with branches and pull requests matching the pattern "push-".
It can scan across organizations or top repositories.

## How to run

```bash
# Scan given users/repos
pnpm --silent start --owner jj-vcs # can be supplied multiple times
pnpm --silent start --repo jj-vcs/jj

# Include pull requests in the search
pnpm --silent start --owner jj-vcs --include-prs

# Top repos on GitHub by stars
pnpm --silent start --top-repos 10 --include-prs
```

## Options

### Repository Selection

- `--owner`: GitHub organization or user to process (can be used multiple times, automatically detects if owner is an org or user)
- `--repo`: Specific repository to process in format "owner/repo" (can be used multiple times)
- `--top-repos`: Number of top repositories by stars to process

### Search Limitation Options

- `--max-repos`: Maximum number of repositories to process in total

### Pull Request Options

- `--include-prs`: Include pull requests in the search (default: false)
- `--pr-status`: Status of pull requests to include: 'open', 'closed', or 'all' (default: 'all')

### Caching and Resume Options

- `--force-refresh`: Force refreshing data from GitHub, ignoring cache (default: false)
- `--clear-cache`: Clear the cache completely before running (default: false)

## Output Format

The tool outputs:

- Repositories with matching branches, grouped by repository
- For each repository, branches are counted by username
- When including PRs with `--include-prs`, repositories with matching pull requests are shown
- Pull requests are counted by user for each repository

## Resumable Execution

The tool supports resumable execution by caching API results and tracking progress.
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
If you don't provide a token, the tool will attempt to use the GitHub CLI (`gh`) to authenticate.

```bash
GITHUB_TOKEN=$(gh auth token) pnpm --silent start [options]
```

## Some output

I ran this on top 1000 repos but it started failing b/c something is broken about writing a 500MB json file.

Anyway:

```

Repositories with matching pull requests:

ohmyzsh/ohmyzsh: 2 matching pull requests
  nasso: 2 PRs

godotengine/godot: 1 matching pull requests
  danderson: 1 PR

neovim/neovim: 64 matching pull requests
  gpanders: 64 PRs

fastapi/fastapi: 1 matching pull requests
  JaniM: 1 PR

sveltejs/svelte: 1 matching pull requests
  zaninime: 1 PR

comfyanonymous/ComfyUI: 1 matching pull requests
  inflation: 1 PR

rust-lang/rustlings: 2 matching pull requests
  cenviity: 1 PR
  samueltardieu: 1 PR

zed-industries/zed: 253 matching pull requests
  maxdeviant: 242 PRs
  maan2003: 7 PRs
  nilehmann: 2 PRs
  ht: 1 PR
  emilazy: 1 PR

git/git: 7 matching pull requests
  chooglen: 7 PRs

starship/starship: 4 matching pull requests
  ab: 3 PRs
  0xdeafbeef: 1 PR

JuliaLang/julia: 1 matching pull requests
  LilithHafner: 1 PR

RocketChat/Rocket.Chat: 3 matching pull requests
  rodrigok: 2 PRs
  engelgabriel: 1 PR

prisma/prisma: 58 matching pull requests
  aqrln: 58 PRs

typst/typst: 24 matching pull requests
  frozolotl: 20 PRs
  swaits: 2 PRs
  johannesneyer: 1 PR
  samueltardieu: 1 PR

bevyengine/bevy: 4 matching pull requests
  SpecificProtagonist: 4 PRs

expo/expo: 1 matching pull requests
  expo-web: 1 PR

ziglang/zig: 8 matching pull requests
  xdBronch: 7 PRs
  tw4452852: 1 PR

vim/vim: 4 matching pull requests
  gpanders: 3 PRs
  mrcjkb: 1 PR

tmux/tmux: 1 matching pull requests
  charlottia: 1 PR

helix-editor/helix: 25 matching pull requests
  ab: 14 PRs
  hunger: 5 PRs
  robinheghan: 1 PR
  kareigu: 1 PR
  valpackett: 1 PR
  Zoybean: 1 PR
  tingerrr: 1 PR
  rslabbert: 1 PR

jgm/pandoc: 10 matching pull requests
  silby: 10 PRs

istio/istio: 1 matching pull requests
  hzxuzhonghu: 1 PR

typeorm/typeorm: 1 matching pull requests
  alper: 1 PR

nushell/nushell: 9 matching pull requests
  qfel: 5 PRs
  ab: 2 PRs
  Zoybean: 1 PR
  eopb: 1 PR

llvm/llvm-project: 13 matching pull requests
  matts1: 7 PRs
  cmarcelo: 4 PRs
  theoparis: 1 PR
  mati865: 1 PR

jqlang/jq: 1 matching pull requests
  marcin-serwin: 1 PR

SerenityOS/serenity: 2 matching pull requests
  kfkonrad: 2 PRs

cockroachdb/cockroach: 14 matching pull requests
  dhartunian: 8 PRs
  davidh: 4 PRs
  rail: 2 PRs

fish-shell/fish-shell: 5 matching pull requests
  dzvon: 4 PRs
  sb: 1 PR

ghostty-org/ghostty: 266 matching pull requests
  mitchellh: 208 PRs
  pluiedev: 34 PRs
  gpanders: 10 PRs
  alaviss: 6 PRs
  iceghost: 3 PRs
  elasticdog: 1 PR
  emilazy: 1 PR
  max397574: 1 PR
  xdBronch: 1 PR
  isinyaaa: 1 PR

nextcloud/server: 1 matching pull requests
  nickvergessen: 1 PR

tokio-rs/tokio: 2 matching pull requests
  sheremetyev: 1 PR
  veykril: 1 PR

Total: 790 matching pull requests in 32 repositories
```
