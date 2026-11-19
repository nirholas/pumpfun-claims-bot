# Contributing to PumpFun Claims Bot

First off, thanks for taking the time to contribute! 🎉

## How Can I Contribute?

### 🐛 Reporting Bugs

- **Check existing issues** first to avoid duplicates
- Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md)
- Include steps to reproduce, expected vs actual behavior, and environment details

### 💡 Suggesting Features

- Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md)
- Explain the use case — *why* is this useful?
- Check the [roadmap](https://github.com/nirholas/pumpfun-claims-bot/issues?q=label%3Aenhancement) for planned features

### 🔧 Pull Requests

1. **Fork & clone** the repository
2. **Create a branch**: `git checkout -b feat/my-feature` or `fix/my-bug`
3. **Install dependencies**: `npm install`
4. **Make your changes** — keep commits focused and atomic
5. **Run checks** (CI runs the same):
   ```bash
   npm run check       # typecheck, lint, test and build in one go
   ```
6. **Push & open a PR** against `main`

### Branch Naming

| Prefix | Purpose |
|--------|---------|
| `feat/` | New features |
| `fix/` | Bug fixes |
| `docs/` | Documentation changes |
| `refactor/` | Code refactoring (no behavior change) |
| `test/` | Adding or updating tests |
| `ci/` | CI/CD changes |

## Development Setup

```bash
# Clone your fork
git clone https://github.com/<your-username>/pumpfun-claims-bot.git
cd pumpfun-claims-bot

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Fill in your API keys (see README for details)

# Start development server (hot reload)
npm run dev

# Run tests
npm test

# Type check and lint
npm run typecheck
npm run lint
```

## Code Style

- **TypeScript** — strict mode enabled
- **ES Modules** — use `import`/`export`, not `require`
- **Naming**: camelCase for variables/functions, PascalCase for types/interfaces
- **ESLint** (`eslint.config.js`, typescript-eslint with type-aware rules) — `npm run lint` must pass; fix the code rather than disabling a rule

## What Makes a Good PR?

- ✅ Solves one problem (don't bundle unrelated changes)
- ✅ Tests pass (`npm test`)
- ✅ Types check and lint pass (`npm run typecheck`, `npm run lint`)
- ✅ Includes tests for new functionality
- ✅ Updates README if adding user-facing features
- ✅ Descriptive PR title and body

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Questions?

Open a [discussion](https://github.com/nirholas/pumpfun-claims-bot/discussions) or file an issue — we're happy to help!
