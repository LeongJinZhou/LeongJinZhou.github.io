# Leong Jin Zhou — Portfolio
> One sentence: what it does and for whom.

![CI](https://github.com/LeongJinZhou/LeongJinZhou.github.io/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-blue)

![Demo](docs/demo.gif)

## Features
- ...

## Tech stack
Next.js · TypeScript · PostgreSQL · Prisma · Playwright · GitHub Actions

## Architecture
(mermaid diagram generated from docs/ARCHITECTURE.md)

## Quality and security
- Unit, integration and end-to-end tests run on every pull request
- Checked against the OWASP Top 10:2025; secret scanning on every commit
- Server-side authorisation, input validation, rate limiting

## How I built it
Spec-first and test-first, with an automated multi-agent workflow I
designed for planning, building, review and CI.

## Getting started
Build with `npm run build` (or `npm run build:ci` for fixture data); the prebuild step copies screenshots into `public/shots`, so `npx astro build` alone skips it.
git clone ... && npm install && npm run dev

## Roadmap
- [ ] ...

## Author
**Leong Jin Zhou**, AI Technologist · [GitHub](https://github.com/LeongJinZhou)

## Deploy

The site deploys to GitHub Pages from `main` (`deploy.yml`). A daily workflow (`refresh.yml`, 00:17 UTC) rebuilds project data onto the `data` branch and redeploys.

One-time setup (repo owner, in GitHub settings):
1. Settings > Pages > Source: GitHub Actions. Turn on Enforce HTTPS.
2. Settings > Environments > github-pages > Deployment branches: `main` only.

Bootstrap order: merge to `main`, then run the `refresh` workflow manually once (Actions > refresh > Run workflow). It creates the `data` branch and deploys. The first push-triggered deploy fails until that branch exists; this is expected.

To run the refresh locally (`node scripts/refresh.ts <outDir>`), set `GITHUB_TOKEN` (a token with no extra scopes is enough): the profile stats use GitHub GraphQL, which needs one. Without it the script stops before writing anything.
