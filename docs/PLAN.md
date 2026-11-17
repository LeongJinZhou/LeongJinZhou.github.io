# PLAN — Portfolio site + profile automation

Source of truth: docs/SPEC.md. Security constraints: docs/SECURITY-RESEARCH.md.

## Status: MVP complete
All 8 slices are built and merged. No more slices are planned.

| # | Slice | PR | Merged |
|---|---|---|---|
| 0 | Scaffold + CI `check` | #1 | 2026-11-15 |
| 1 | Project data from GitHub | #3 | 2026-11-15 |
| 2 | README to safe HTML | #4 | 2026-11-16 |
| 3 | Portfolio site | #5 | 2026-11-16 |
| 4 | Deploy + daily refresh | #6 | 2026-11-16 |
| 5 | Cards + screenshots | #7 | 2026-11-16 |
| — | Featured forks | #8 | 2026-11-16 |
| 6 | GitHub profile README | #9 | 2026-11-16 |
| 7 | Weekly health check | #10 | 2026-11-17 |

## Left (owner only, no code)
- Profile page (S7): re-create `PROFILE_REPO_TOKEN` (fine-grained, repo `LeongJinZhou/LeongJinZhou` only, Contents read/write), then run `refresh` by hand.
- LinkedIn URL: set `linkedinUrl` in `config/site.json` when wanted.
- Broken live demo: qiu-cpdc-career-portal homepage returns 404 (health issue #11).

## Layout
```
config/        site.json featured.txt hidden.txt health-ignore.txt settings.json overrides/
profile/       README.template.md
scripts/       refresh.ts screenshots.ts health-scan.ts health-report.ts
scripts/lib/   schemas github select readme svg profile shots links issue list
src/           layouts/ pages/ components/ lib/data.ts
tests/         unit/ integration/ e2e/ fixtures/
.github/       workflows/{ci,refresh,deploy,health}.yml dependabot.yml
```

## Workflows
All: top-level `permissions: {}`, SHA-pinned actions, `persist-credentials: false`.

| File | Trigger | What it does |
|---|---|---|
| ci.yml | PR, push main | lint, typecheck, unit + integration + coverage, build, e2e + axe, Lighthouse, npm audit, osv-scanner |
| refresh.yml | daily 00:17 UTC, by hand | GitHub data, snake, screenshots -> `data` branch -> deploy -> profile repo push; `verdict` fails the run on any failed job |
| deploy.yml | push main, by hand, called by refresh | build `main` + `data` -> GitHub Pages |
| health.yml | Monday 01:17 UTC, by hand | scan site + profile links -> one `health-check` issue (create / update / close) |
| dependabot.yml | weekly | npm + actions, minor + patch grouped |

## Risks
- GitHub disables schedules after 60 days with no repo activity; daily data commits keep it active.
- `PROFILE_REPO_TOKEN` expires (90 days max): the `profile` job then fails and the run goes red.
