# Project: LeongJinZhou.github.io (portfolio)

## What it is
Public portfolio site for Leong Jin Zhou, AI Technologist at QIU. Lists his public GitHub projects and refreshes itself daily. Details in docs/SPEC.md.

## Tech stack
- Astro 7 static site (GitHub Pages), TypeScript strict, Node 24, no client framework
- Vitest (v8 coverage 80%) + Playwright (chromium, axe) + ESLint
- Scripts: plain .ts run with node (type stripping); generated data on orphan `data` branch

## Commands
- Run: npm run dev
- Lint: npm run lint | Types: npm run typecheck
- Test: npm test | E2E: npm run test:e2e

## Roles and permissions (source of truth: docs/SPEC.md)

## Key docs
docs/SPEC.md · docs/ARCHITECTURE.md · docs/API.md · docs/PLAN.md ·
docs/STATUS.md (local only) · docs/RELEASE.md
