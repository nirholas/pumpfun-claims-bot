# AGENTS.md

Operating notes for AI coding agents (Claude Code, Codex, Cursor, Copilot and others) working in this repository. Everything here is derived from the files actually in the tree, so trust it over guesses, and update it when the facts change.

## What this repository is

PumpFun GitHub social fee claim monitor - real-time Telegram feed for first-time creator fee claims on Solana

- Homepage: https://nirholas.github.io/pumpfun-claims-bot/
- Source: https://github.com/nirholas/pumpfun-claims-bot
- Primary language: TypeScript
- License: Other (see the LICENSE file)

## Repository layout

- `docs/`
- `leaderboard-bot/`
- `packages/`
- `src/`
- `web/`
- `README.md`
- `LICENSE`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `CHANGELOG.md`
- `package.json`
- `Dockerfile`

## Setup

```bash
npm install
```

## Commands

| Task | Command |
|---|---|
| dev | `npm run dev` |
| start | `npm start` |
| build | `npm run build` |
| test | `npm test` |
| typecheck | `npm run typecheck` |
| build image | `docker build .` |

Run the test and lint commands above before you consider a change finished. If a command fails on code you did not touch, say so in your report instead of silently skipping it.

## Conventions

- TypeScript runs in strict mode; do not loosen `tsconfig.json` to make an error go away.
- `.env` files are gitignored; never commit credentials, and read configuration from environment variables.
- Commit messages follow Conventional Commits (`type(scope): summary`), matching the existing history.
- Read `CONTRIBUTING.md` before opening a pull request.
- User-visible changes get an entry in `CHANGELOG.md`.
- Read the surrounding code before adding to it, and match its naming, file organisation and error-handling style.
- Keep `README.md` accurate: if a change alters behaviour, commands or configuration, update the docs in the same commit.
- Do not leave TODO comments, stub functions, placeholder data or commented-out code behind. Finish what you start or leave it out.
- Small, focused commits with a subject line that describes the change, not the act of committing.

## Where to raise things

- Bugs and feature requests: https://github.com/nirholas/pumpfun-claims-bot/issues
- Questions and ideas: https://github.com/nirholas/pumpfun-claims-bot/discussions
- Security issues: follow `SECURITY.md`, never a public issue.
