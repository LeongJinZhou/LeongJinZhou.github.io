# PLAN — Portfolio site + profile automation (MVP)

Source of truth: docs/SPEC.md. Security constraints: docs/SECURITY-RESEARCH.md (versions, pinned SHAs, hardening). Status: architect PASS; founder approved Gate 1 on 2026-11-15.

## 1. Stack and layout
- Astro 7.4.12 static, TypeScript strict, Node 24. No client framework; one small filter script.
- Scripts: plain `.ts` run by `node scripts/x.ts` (Node 24 type stripping). Erasable syntax only, `.ts` import extensions.
- Vitest + v8 coverage (80% threshold on `scripts/**`, `src/lib/**`). @playwright/test 1.65.1 + @axe-core/playwright. @lhci/cli.
- remark-parse + remark-rehype + rehype-sanitize 6.0.0 + rehype-stringify. zod for API responses and config. sharp for WebP.
- GitHub API via plain `fetch`. ESLint + typescript-eslint + eslint-plugin-astro.
- Generated data on an orphan `data` branch, not `main` (Q1). Build reads `DATA_DIR` (required).
- tsconfig: `strict`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `noEmit`. astro.config: `site: 'https://leongjinzhou.github.io'`, `build.inlineStylesheets: 'never'`.

```
config/        site.json featured.txt hidden.txt settings.json overrides/<repo>.json
profile/       README.template.md   (current profile README wording + <!-- gen:x --> markers)
scripts/       refresh.ts screenshots.ts health-scan.ts health-report.ts
scripts/lib/   schemas.ts github.ts select.ts readme.ts svg.ts profile-readme.ts shots.ts links.ts issue.ts
src/           layouts/Base.astro pages/index.astro pages/projects/[name].astro
               components/ProjectCard.astro scripts/filter.ts styles/global.css lib/data.ts
tests/         unit/ integration/ e2e/ fixtures/github/ fixtures/generated/
.github/       workflows/{ci,refresh,deploy,health}.yml dependabot.yml
```
`config/settings.json`: health retries 3, timeout 15000 ms; shot 1280x800, timeout 30000 ms.

## 2. Slices (build order; each one PR, test-first)

### Slice 0 — Scaffold + green "check" (ci.yml) — DONE (PR #1, merged 2026-11-15)
- Files: package.json + lockfile, astro.config, tsconfig, eslint, vitest, playwright config (webServer `astro preview`, chromium, 375 + 1280), `src/pages/index.astro`, `src/layouts/Base.astro` (meta CSP + referrer), ci.yml, dependabot.yml, CLAUDE.md tech stack, `.gitignore` += `generated/`, `public/shots/`.
- Tests first: e2e smoke (loads, `<h1>` has name, zero CSP console errors).
- Accept: `check` green on PR; `npm audit --audit-level=moderate` clean.

### Slice 1 — Project data (refresh/generate) — DONE (PR #3, merged 2026-11-15)
- First: add `scripts/tsconfig.json` extending root with `"module":"NodeNext","moduleResolution":"NodeNext"`, include `scripts/**` (+ any src/lib it imports); `typecheck` script gains `&& tsc -p scripts`. No `paths`. JSON imports use `with { type: 'json' }`.
- Files: `scripts/lib/{schemas,github,select}.ts`, `scripts/refresh.ts`, config files (featured.txt = 8 from rule 4; health-ignore.txt with LinkedIn; overrides seeded from current profile README titles/descriptions), `tests/fixtures/github/*`.
- Unit: excludes hidden, fork, archived, private, two self repos (S6, rules 1-2); new repo appears (S5); sort pushedAt desc (rule 5); featured order, hidden featured skipped (rule 4); override replaces title/description/screenshot only (rule 6); repo name `^[A-Za-z0-9._-]+$`; homepage kept only if https; pagination.
- Integration: `refresh.ts` as child process vs `node:http` stub (`GITHUB_API_URL`), temp out dir, compare `projects.json` (S4). Stub 500 or 0 repos: output byte-identical, exit non-zero (S10, rule 13). Write to temp then rename after all fetches succeed.

### Slice 2 — README to safe HTML — DONE (PR #4, merged 2026-11-16)
- Files: `scripts/lib/readme.ts`, wired into refresh (`readmeHtml`).
- Unit: `<script>`, raw HTML, `on*`, `javascript:`/`data:` hrefs removed; relative images -> `raw.githubusercontent.com/<owner>/<repo>/<branch>/...`; relative links -> blob URL; images on any https host kept (badges), non-https images dropped (rule 7); clobber prefix; missing README -> "" (S3, rule 7).

### Slice 3 — Site (ci/check) — DONE (PR #5, merged 2026-11-16)
- Files: `src/lib/data.ts` (reads `DATA_DIR`, zod, re-applies hidden.txt), `index.astro`, `projects/[name].astro`, `ProjectCard.astro`, `filter.ts` (external module), `global.css`, `tests/fixtures/generated/*`, lighthouserc. Shots copied `DATA_DIR/shots` -> `public/shots` by a one-line `node -e` in the npm prebuild script (`fs.existsSync` check, then `fs.cpSync(src, dst, {recursive: true, force: true})`; works on Windows; no copy script).
- Design: technical, bold, dark-first; light via `prefers-color-scheme`. Near-black base, two accents (not purple). System + mono fonts, no web fonts. Language-bytes bar and "last refreshed" line. Motion off under reduced motion. Empty filter -> message + reset; no screenshot -> card; LinkedIn unset -> hidden.
- CSP: no inline `<script>`, no inline `<style>`, no `style=` attributes anywhere (meta CSP default-src 'self' blocks them). Language bar drawn as SVG with `width` attributes. Meta CSP `img-src 'self' https: data:` (badges allowed, founder Gate 1).
- Unit: filter list = language + topics deduped; hidden re-applied (S6).
- Build test: fails if any file in `dist/` contains an inline `<script>` (without `src`), a `<style>` element, or a `style=` attribute.
- E2E: 6 sections + hero (S1); filter + reset (S2); detail page title, stack, screenshot, repo link, live link only when homepage (S3); no LinkedIn when empty, no email/phone (rule 17); axe 0 at 375/1280 on home + one detail; no horizontal scroll at 375 (rules 18-19).
- CI: lhci home + one detail, all four >= 0.90, 3 runs.

### Slice 4 — Deploy + minimal refresh loop (deploy.yml, refresh.yml)
- Jobs generate, commit, deploy, verdict.
- Verify: two manual runs: first commits `chore: daily refresh`, second commits nothing (rule 14); manual run redeploys (S4); new public repo shows (S5).
- Bootstrap: commit job creates orphan `data` branch. First push-triggered deploy fails once until first manual refresh (note in PR).

### Slice 5 — Cards and screenshots (refresh/screenshots)
- Files: `scripts/lib/svg.ts` (card), `scripts/lib/shots.ts`, `scripts/screenshots.ts`.
- Unit: card SVG escapes `< > & "`; `isBlockedAddress` rejects localhost, 127/8, 0/8, 10/8, 100.64/10, 172.16/12, 192.168/16, 169.254/16, ::, ::1, fc00::/7, IPv4-mapped `::ffff:` forms of all of these, non-https; chooser ok/new, fail/previous, fail/none -> card (rules 8-9).
- SSRF guard: every request (incl. each redirect hop) resolves its host with `dns.lookup({all:true})`; blocked if ANY address is blocked. Unit test: a hostname resolving to 127.0.0.1 is blocked; a redirect to a blocked host is blocked.
- Integration: real Chromium vs local page (explicit test allow-host) -> 1280x800 WebP; hanging page times out, keeps previous, reports failure.
- Screenshot failure: `screenshots` job keeps old images, exits 0 and sets job output `failed=true`; `commit` and `deploy` run normally; `verdict` (`needs: screenshots`) fails the run when `failed == 'true'` (Q7, rule 9).
- Check: a manual run with a forced failing screenshot still commits and deploys, and the run ends red.

### Slice 6 — Profile (refresh/generate + refresh/profile)
- Files: `svg.ts` (banner, stats, langs, dark + light), `profile-readme.ts`, `profile/README.template.md`, snk step, profile job.
- Stats GraphQL: `user(login:"LeongJinZhou"){contributionsCollection, pullRequests}`, never `viewer` (with GITHUB_TOKEN viewer is the bot).
- Unit: top 6 languages by bytes across shown repos; stats from fixture GraphQL; template keeps hand-written lines, replaces only between markers; missing marker -> error; featured rows follow featured.txt; LinkedIn row absent when unset (rules 11, 17).
- Integration: refresh run on fixtures produces SVGs byte-equal to expected fixtures (S4); every relative image/link in generated README resolves to a file (S7); SVGs parse as XML, no external URLs (rule 11).
- Tech badges (shields.io) for `config/site.json` skills in profile README and site Skills section (rule 7a); unit test: badge URL built from skill name is URL-encoded.
- Snake: Platane/snk pinned SHA in its own `snake` job (contents: read), dark + light, output passed on as artifact (rule 12).
- Profile push job: no third-party actions, no npm, no Playwright. PAT via env + `git -c http.extraheader="AUTHORIZATION: basic ..."`, never in the remote URL. Commits only when changed, message `chore: daily refresh` (rule 14).
- Push skipped with `::warning::` when `PROFILE_REPO_TOKEN` empty; run stays green.
- Manual check: github.com/LeongJinZhou shows banner, cards, snake, shots after a real run (S7).

### Slice 7 — Health check (health.yml)
- Files: `scripts/lib/{links,issue}.ts`, `scripts/health-scan.ts`, `scripts/health-report.ts` (Node built-ins only, no `npm ci`).
- Scan crawls live site (same-origin, capped) + live profile README links. Fetch uses `redirect: 'manual'`; a 3xx counts as working.
- Unit: extraction + dedupe; http/https only; retry 3; 2xx/3xx ok, else fail; URLs matching `config/health-ignore.txt` skipped (rule 15); `decide(openIssues, failures)` -> create/update/close/none (rule 16, S9).
- Integration: stub with one 500 URL -> one issue body listing it (S8); fake `gh` on PATH: failing + open issue edits, clean run closes with comment (S9).

## 3. Workflows
All: top-level `permissions: {}`, SHA-pinned actions, `persist-credentials: false`, `${{ }}` via `env:` only, no `pull_request_target`, no `workflow_run`.

| File | Trigger | Jobs and permissions |
|---|---|---|
| ci.yml | pull_request, push main | `check` (contents: read): npm ci, lint, typecheck, unit + integration + coverage, playwright chromium, build with `DATA_DIR=tests/fixtures/generated`, e2e + axe, lhci, npm audit, osv-scanner |
| refresh.yml | cron `0 0 * * *`, dispatch; concurrency `refresh` | `generate` (contents: read), `snake` (contents: read), `screenshots` (contents: read, no secrets), `commit` (contents: write, no npm; `needs: [generate, snake, screenshots]`), `deploy` (`uses: ./.github/workflows/deploy.yml`, job `permissions: {contents: read, pages: write, id-token: write}`, `needs: commit`), `profile` (contents: read; PAT only in push step; `needs: [generate, snake, screenshots]`, downloads generate + snake + shots artifacts), `verdict` (`if: always()`, `needs: [generate, snake, screenshots, commit, deploy, profile]`). `commit`, `deploy`, `profile` all require `generate` success (rule 13). |
| deploy.yml | push main, dispatch, workflow_call | `build` (contents: read): main + `data` -> build -> upload-pages-artifact; `deploy` (pages: write, id-token: write; env `github-pages`; concurrency `pages` on this job) |
| health.yml | cron `0 1 * * 1`, dispatch | `scan` (contents: read), `report` (issues: write): `gh label create health-check --force`, `gh issue` create/edit/close |
| dependabot.yml | weekly | npm + github-actions, minor + patch grouped |

## 4. Open questions
- Q1: DECIDED — `data` branch.
- Q2: DECIDED — feature all 8.
- Q3: DECIDED — `config/health-ignore.txt`, LinkedIn pre-listed.
- Q4: founder creates `PROFILE_REPO_TOKEN` (profile repo only, Contents RW, 90 days).
- Q5: resolved — SHAs for upload-artifact, download-artifact, osv-scanner-action added to SECURITY-RESEARCH.md.
- Q6: DECIDED — keep badges; CSP img-src allows https:.
- Q7: screenshot failure = keep old, deploy, mark run failed.
- Q8: stats count public contributions only.
- Q9: one-time settings: Pages source = Actions, Enforce HTTPS, `github-pages` env limited to main.

## Risks
- Lighthouse flake on shared runners: 3 runs, system fonts, sized WebP, no third-party requests.
- Astro inlining scripts/styles breaks meta CSP: e2e fails on any CSP console error.
- GitHub disables schedules after 60 days of inactivity: daily data commits prevent it.
- sharp card text uses runner fonts: generic sans-serif.
