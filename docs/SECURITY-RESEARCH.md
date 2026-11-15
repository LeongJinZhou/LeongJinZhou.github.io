# Security research — 2026-11-15

Sources: npm registry, GitHub Advisory DB, action SHAs resolved via gh on 2026-11-15.

## Versions
- astro 7.4.12 (must be >= 7.4.7: GHSA-26w7-cxv4-gfx2, GHSA-r3h5-4585-7x3w, GHSA-98hj-9722-w3j8).
- Node 24 LTS (24.22.3+).
- @playwright/test 1.65.1 (>= 1.55.1, GHSA-7mvr-c777-76hp). Keep current: bundled Chromium carries CVEs.
- overrides.minimatch=11.0.8 for GHSA-g3hv-75wg-m249 (typescript-eslint 8.72.2 pulls 10.2.6); drop when typescript-estree accepts 11.
- Commit lockfile, `npm ci`, `npm audit` + osv-scanner in CI.

## Actions pinned by SHA
- actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 (v7.0.1)
- actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 (v7.1.0)
- actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d (v6.0.0)
- actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 (v5.0.0)
- actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346 (v5.0.1)
- Platane/snk@d8f6715049803e982ee5ff501b6b9b7d5deeb09b (v3.5.0)
- actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 (v7.0.2)
- actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 (v8.0.2)
- google/osv-scanner-action@32d3cd482bdadfb38b186c0ad1b031902d55d932 (v2.7.1)
- Dependabot (github-actions + npm) bumps SHAs.

## Markdown sanitising
- remark-parse + remark-rehype (allowDangerousHtml off) + rehype-sanitize 6.0.0 defaultSchema.
- Only http/https in href/src. clobberPrefix for id/name.
- Avoid DOMPurify+jsdom (many 2026 advisories). If marked: >= 18.0.2.

## Workflow hardening
- Top-level `permissions: {}`; per job: refresh `contents: write`; deploy `pages: write` + `id-token: write`; health `issues: write`.
- No pull_request_target, no workflow_run.
- `${{ }}` values via env vars, never inline in `run:`.
- `persist-credentials: false` on checkout.
- No third-party issue actions; use `gh issue` with GITHUB_TOKEN (2026 tag hijacks: trivy-action, xygeni-action, actions-cool/issues-helper).
- `github-pages` environment for deploy.

## PAT (profile repo push)
- Fine-grained, repo LeongJinZhou/LeongJinZhou only, Contents read+write, 90-day expiry.
- Used only in the profile push step; never in steps that run npm install or Playwright.

## Playwright screenshots
- Separate job, `permissions: contents: read`, no secrets in env.
- Headless Chromium, fresh context, 30 s timeout, `acceptDownloads: false`, `serviceWorkers: 'block'`.
- https only; `page.route` guard blocks private/link-local/localhost IPs (incl. 169.254.169.254).

## Headers (Pages cannot set headers)
- Meta CSP: `default-src 'self'; img-src 'self' https: data:; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'`.
- Check Astro 7 `security.csp` status for inline script hashing.
- frame-ancestors ignored in meta CSP (accepted low risk).
- `<meta name="referrer" content="strict-origin-when-cross-origin">`; Enforce HTTPS on.

## Slice 2 deps (2026-11-15)
Sources: GitHub Advisory DB (global + repo advisories), `npm audit` (0 vulns), `osv-scanner` on package-lock.json (no issues), `npm audit signatures` (all verified).

| Package | Locked | Latest | Advisories |
|---|---|---|---|
| unified | 11.0.5 | 11.0.5 | none |
| remark-parse | 11.0.0 | 11.0.0 | none |
| remark-rehype | 11.1.2 | 11.1.2 | none |
| rehype-sanitize | 6.0.0 | 6.0.0 | none |
| rehype-stringify | 10.0.1 | 10.0.1 | none |
| micromark | 4.0.3 | 4.0.3 | none |
| mdast-util-from-markdown | 2.1.0 | 2.1.0 | none |
| mdast-util-to-hast | 13.2.2 | 13.2.2 | GHSA-4fh9-h7wg-q85m (medium, unsanitized `class`, >=13.0.0 <13.2.1) - patched in our version |
| hast-util-sanitize | 5.0.2 | 5.0.2 | none |
| hast-util-to-html | 9.0.6 | 9.0.6 | none |

- Genuine: all published by `wooorm` (maintainers wooorm/remcohaszing/johno/kmck, unchanged), repos syntax-tree/rehypejs/remarkjs/micromark; releases match GitHub tags.
- Fresh releases: mdast-util-to-hast 13.2.2 (2026-11-13, footnote backreference fix), hast-util-to-html 9.0.6 (2026-10-29), micromark 4.0.3 (2026-09-26). Same maintainer, small diffs; keep lockfile pinned, no auto-bump.
- Sanitiser: no known defaultSchema bypass. Upstream rule: deviate from defaultSchema only by narrowing. Our schema only narrows `href`/`src` to http(s). Sanitize runs last before stringify (after URL rewrite) - keep it that way. Never add `allowDangerousHtml`/`rehype-raw` without re-review.
- Lesson: patched GHSA-4fh9 shows mdast-util-to-hast output is untrusted; always sanitize after it.
