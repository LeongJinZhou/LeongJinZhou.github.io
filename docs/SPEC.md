# SPEC — Leong Jin Zhou portfolio and GitHub profile

## 1. Summary
A public portfolio site at https://leongjinzhou.github.io presents Leong Jin Zhou, AI Technologist at QIU, and every public project he owns.
His GitHub profile README (repo `LeongJinZhou/LeongJinZhou`) gets a banner, stats and language cards, a contribution snake and project screenshots.
Both refresh themselves daily from GitHub, and a weekly health check opens an issue when a link or live demo breaks.

## 2. Permission matrix

| Action | Visitor | Owner (Leong, via GitHub) | Automation (GitHub Actions) |
|---|---|---|---|
| View portfolio site and profile | yes | yes | — |
| Edit content (about, featured list, hide-list, LinkedIn URL) | no | yes (commit / PR) | no |
| Regenerate project data, cards, screenshots | no | yes (manual run) | yes (schedule) |
| Commit generated files | no | yes | yes, only generated paths, with `GITHUB_TOKEN` |
| Deploy site to GitHub Pages | no | yes (manual run) | yes |
| Open / update / close health issues | no | yes | yes |

The site is static. It has no login, no forms, no visitor data and no server.

## 3. User stories
- S1. When a visitor opens the site, they see the hero (name, title, short pitch), About, Featured projects, All projects, Skills and Contact.
- S2. When a visitor filters All projects by a technology, only projects using it are shown.
- S3. When a visitor opens a project, they see its detail page: summary, stack, screenshot, links to repo and live demo, and content built from its README.
- S4. When the daily refresh runs, project data, profile cards and screenshots are rebuilt from GitHub and the site redeploys.
- S5. When Leong makes a new public repo, it appears on the site and in the profile project list after the next daily refresh.
- S6. When Leong adds a repo to the hide-list, it disappears from the site after the next refresh or push.
- S7. When a visitor opens github.com/LeongJinZhou, they see the banner, stats and languages cards, contribution snake, featured projects with screenshots, skills and contact.
- S8. When the weekly health check finds a broken link or live demo, an issue is opened in the portfolio repo listing each failure.
- S9. When a later health check finds everything working, the open health issue is closed with a comment.
- S10. When the GitHub API or a screenshot fails during a refresh, the last good data stays live and the run fails visibly.

## 4. Business rules
1. Projects shown = public, non-fork, non-archived repos owned by `LeongJinZhou`, minus the hide-list, minus `LeongJinZhou` and `LeongJinZhou.github.io` themselves.
2. `qiu-ai-video-2026` is included. `Print` is private and so is excluded by rule 1.
3. Hide-list and featured list are plain files in the portfolio repo, edited by hand.
4. Featured projects, in order: qiu-cpdc-career-portal, qiu-sld-campus-hub, sld-event-verifier, university-ims-erp, Healthcare-Analysis-POC, SmartRecipe-ContextAware-iOS, Pocket-G, OCR1. A featured repo that becomes hidden or private is skipped.
5. All projects are sorted by last push, newest first.
6. A project's title, description, topics, language, homepage and last push come from the GitHub API. A per-repo override file may replace title, description or screenshot.
7. Detail pages render the repo README as sanitised Markdown. Raw HTML is stripped, and relative image links are rewritten to the repo's raw URLs. Images from any https host (including badges such as img.shields.io) are kept; only non-https images are dropped.
7a. The profile README and the site Skills section show technology badges (shields.io style) for the skills in `config/site.json`.
8. Screenshots are captured only for repos with a homepage URL, at 1280×800, saved as WebP. Repos without one get a generated card image (name, language, topics).
9. A screenshot that fails keeps the previous image. If none exists, the generated card is used.
10. Daily refresh runs at 00:00 UTC (08:00 Malaysia time) and can be started by hand.
11. Profile stats (repos, stars, commits in the last year, PRs, top 6 languages by bytes across shown repos) are computed in the Action and written as SVG files into the profile repo. No third-party image servers.
12. Contribution snake: SVG regenerated daily, in dark and light variants.
13. A refresh that fetches 0 projects, or gets any API error, does not commit or deploy anything.
14. Generated commits are made only when files actually changed, with message `chore: daily refresh`.
15. Health check runs weekly, Monday 01:00 UTC, and by hand. It checks every link on the site and profile README, plus every live demo, except URLs matching a line in `config/health-ignore.txt` (LinkedIn pre-listed, since it answers bots with HTTP 999). Each URL is retried up to 3 times. Only HTTP 2xx/3xx counts as working, and the timeout is 15 s.
16. At most one open health issue (label `health-check`). A new failure updates that issue rather than opening a duplicate. A clean run closes it.
17. Contact: GitHub and LinkedIn only. No email or phone is published. The LinkedIn URL lives in one config value. Until it is set, the LinkedIn link is hidden.
18. Style: bold, techy, dark-first with a light variant. Gradients and motion respect `prefers-reduced-motion`.
19. Site meets WCAG 2.2 AA, works at 375 px width and up, and scores Lighthouse 90+ on performance, accessibility, best practices and SEO.

## 5. Data model (files, no database)
- `projects.json` (generated): list of { name, title, description, topics[], language, languages{}, homepage, repoUrl, pushedAt, stars, screenshot, featured, readmeHtml }.
- `profile.json` (generated): { stats{}, topLanguages[], updatedAt }.
- `config/featured.txt`, `config/hidden.txt`: one repo name per line.
- `config/site.json`: { name, title, pitch, about, linkedinUrl, skills[] }.
- `config/overrides/<repo>.json` (optional): { title?, description?, screenshot? }.
- Profile repo: `README.md`, `assets/banner.svg`, `assets/stats-*.svg`, `assets/langs-*.svg`, `assets/snake-*.svg`, `assets/shots/*.webp`.

## 6. Scale assumptions
- 1 owner, 1 organisation (the personal account). About 10–50 repos over the next years.
- Visitors: low hundreds per month. The site is static on a CDN, so no load concern.
- GitHub API use stays under 500 calls per run, well within the `GITHUB_TOKEN` limit.
- The handbook's multi-tenant and pagination rules do not apply (no database, no users). The API calls still paginate repos.

## 7. Acceptance criteria
- S1: Done when an e2e test (Playwright) loads the built site and finds all 6 sections, with the hero showing name and title.
- S2: Done when an e2e test picks a technology filter and only matching project cards remain.
- S3: Done when an e2e test opens a project page and sees its title, stack, screenshot and working repo link, and a unit test proves README HTML is sanitised (script tags removed) and relative images are rewritten.
- S4: Done when an integration test runs the refresh script against recorded GitHub API responses and gets the expected `projects.json` and SVG files, and a manual workflow run on GitHub succeeds and redeploys.
- S5: Done when a unit test proves a new public repo in the API response appears in `projects.json`.
- S6: Done when a unit test proves hidden, fork, archived and self repos are excluded.
- S7: Done when a test checks the generated profile README links to existing banner, stats, languages, snake and screenshot files, and the profile page shows them after a real run.
- S8: Done when an integration test with a stubbed failing URL produces one issue body listing that URL.
- S9: Done when a test proves a clean run closes the open issue and a failing run updates rather than duplicates it.
- S10: Done when tests prove an API error or 0 projects leaves files unchanged and the script exits non-zero.
- Rules 18–19: Done when the CI Lighthouse check scores 90+ in all four categories and an axe scan reports 0 violations at 375 px and 1280 px.

## 8. Out of scope
- CV download.
- Private repos, in any form.
- Blog, analytics, contact form, comments, visitor tracking.
- Custom domain.
- Showing email or phone.
- Setting GitHub pinned repos (no API; owner sets by hand).

## 9. Assumptions made
1. LinkedIn URL is supplied by the owner later. The link stays hidden until then.
2. The featured list starts with the 6 projects listed in rule 4.
3. Daily refresh time is 00:00 UTC; the health check is Monday 01:00 UTC.
4. Health failures are reported only as a GitHub issue, which notifies the owner by GitHub's normal email setting.
5. Forks and archived repos are never shown.
6. Screenshots only for repos with a homepage URL; the others get generated cards.
7. Detail pages are generated from each README, not hand-written.
8. Stats cards are self-generated, not from github-readme-stats or similar services.
9. The site is English only.
11. Generated data is committed to a separate `data` branch; `main` stays protected (founder decision, Gate 1).
12. Content-Security-Policy `img-src` allows any https host so README badges stay (founder decision, Gate 1).
10. A dedicated token is used only if `GITHUB_TOKEN` cannot write to the profile repo from the portfolio repo's Action. That is likely, since it is cross-repo, so the owner may need to create one fine-grained token limited to the two repos.
