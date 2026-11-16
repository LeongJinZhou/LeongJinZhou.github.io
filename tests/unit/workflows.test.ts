import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const obj = (v: unknown, what: string): Obj => {
  if (!isObj(v)) throw new Error(`${what} is not a mapping`)
  return v
}

const dir = fileURLToPath(new URL('../../.github/workflows/', import.meta.url))
const files = readdirSync(dir).filter((f) => f.endsWith('.yml'))
const raw = (f: string) => readFileSync(dir + f, 'utf8')
const doc = (f: string): Obj => obj(parse(raw(f)), f)
const jobs = (f: string): [string, Obj][] => Object.entries(obj(doc(f).jobs, `${f} jobs`)).map(([n, j]) => [n, obj(j, n)])
const stepsOf = (j: Obj): Obj[] => (Array.isArray(j.steps) ? j.steps.map((s) => obj(s, 'step')) : [])
const allSteps = (f: string) => jobs(f).flatMap(([, j]) => stepsOf(j))
const triggers = (f: string): string[] => {
  const on = doc(f).on
  if (typeof on === 'string') return [on]
  if (Array.isArray(on)) return on.map(String)
  return Object.keys(obj(on, `${f} on`))
}

// Allowed non-read permissions, keyed "file:job".
const WRITE_ALLOW: Record<string, Obj> = {
  'refresh.yml:commit': { contents: 'write' },
  'deploy.yml:deploy': { pages: 'write', 'id-token': 'write' },
  'refresh.yml:deploy': { contents: 'read', pages: 'write', 'id-token': 'write' },
}

describe('workflows', () => {
  it('has ci, deploy and refresh', () => {
    expect(files).toEqual(expect.arrayContaining(['ci.yml', 'deploy.yml', 'refresh.yml']))
  })
  describe.each(files)('%s', (f) => {
    it('top-level permissions are empty', () => expect(doc(f).permissions).toEqual({}))
    it('job permissions are plain mappings, read/none unless allowlisted', () => {
      for (const [n, j] of jobs(f)) {
        const p = j.permissions
        if (p === undefined) continue
        expect(isObj(p), `${n}: permissions must be a mapping`).toBe(true)
        const allowed = WRITE_ALLOW[`${f}:${n}`]
        if (allowed) {
          expect(p, n).toEqual(allowed)
          continue
        }
        for (const [k, v] of Object.entries(obj(p, n))) expect(['read', 'none'], `${n}.${k}`).toContain(v)
      }
    })
    it('external actions (steps and job-level uses) are pinned to a 40-hex SHA', () => {
      const refs = [...jobs(f).map(([, j]) => j.uses), ...allSteps(f).map((s) => s.uses)].filter((u): u is string => typeof u === 'string')
      for (const ref of refs) if (!ref.startsWith('./')) expect(ref).toMatch(/@[0-9a-f]{40}$/)
    })
    it('every pinned action line carries a # vX comment', () => {
      for (const l of raw(f).split('\n').filter((l) => /\buses:\s*[^.\s]/.test(l))) expect(l).toMatch(/# v\d/)
    })
    it('checkout never persists credentials', () => {
      const co = allSteps(f).filter((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout@'))
      if (f === 'ci.yml' || f === 'deploy.yml') expect(co.length).toBeGreaterThan(0)
      for (const s of co) expect(obj(s.with, 'checkout with')['persist-credentials']).toBe(false)
    })
    it('no ${{ }} inside run scripts', () => {
      for (const s of allSteps(f)) expect(String(s.run ?? '')).not.toContain('${{')
    })
    it('no pull_request_target or workflow_run trigger', () => {
      expect(triggers(f)).not.toContain('pull_request_target')
      expect(triggers(f)).not.toContain('workflow_run')
    })
    it('every job has timeout-minutes (except reusable-workflow callers)', () => {
      for (const [n, j] of jobs(f)) if (!j.uses) expect(j['timeout-minutes'], n).toBeGreaterThan(0)
    })
  })

  it('refresh: cron, concurrency, job set', () => {
    const r = doc('refresh.yml')
    const on = obj(r.on, 'on')
    expect(obj((on.schedule as unknown[])[0], 'schedule').cron).toBe('0 0 * * *')
    expect(on).toHaveProperty('workflow_dispatch')
    expect(r).toHaveProperty('concurrency.group', 'refresh')
    expect(r).toHaveProperty('concurrency.cancel-in-progress', false)
    expect(jobs('refresh.yml').map(([n]) => n).sort()).toEqual(['commit', 'deploy', 'generate', 'profile', 'screenshots', 'snake', 'verdict'])
  })
  it('refresh: commit job has no npm/node, copies allowlisted paths, rejects symlinks/hidden', () => {
    const c = Object.fromEntries(jobs('refresh.yml')).commit as Obj
    expect(c.needs).toEqual(['generate', 'screenshots'])
    expect(c.if).toBe("github.ref == 'refs/heads/main'")
    const runs = stepsOf(c).map((s) => String(s.run ?? '')).join('\n')
    expect(runs).not.toMatch(/\b(npm|npx|node)\b/)
    expect(JSON.stringify(c)).not.toContain('setup-node')
    expect(runs).toContain('git status --porcelain')
    expect(runs).toContain('-type l')
    expect(runs).toContain('projects.json')
    expect(runs).not.toContain('cp -R "$GENERATED"/.')
    expect(runs).toMatch(/user\.name="[^"]+"/)
    expect(runs).toMatch(/user\.email="[^"]+"/)
  })
  it('refresh: generate upload excludes hidden files', () => {
    const up = allSteps('refresh.yml').find((s) => String(s.uses).startsWith('actions/upload-artifact@'))
    expect(obj(up?.with, 'upload with')['include-hidden-files']).toBe(false)
  })
  it('refresh: deploy calls deploy.yml after commit', () => {
    const d = Object.fromEntries(jobs('refresh.yml')).deploy as Obj
    expect(d.uses).toBe('./.github/workflows/deploy.yml')
    expect(d.needs).toBe('commit')
  })
  it('refresh: verdict always runs and needs every job', () => {
    const v = Object.fromEntries(jobs('refresh.yml')).verdict as Obj
    expect(v.if).toBe('always()')
    expect(v.needs).toEqual(['generate', 'screenshots', 'snake', 'commit', 'profile', 'deploy'])
  })
  it('refresh: snake job is read-only, pinned to Platane/snk, makes dark and light, uploads artifact snake (rule 12)', () => {
    const s = Object.fromEntries(jobs('refresh.yml')).snake as Obj
    expect(s.permissions).toEqual({ contents: 'read' })
    expect(s.needs).toBeUndefined()
    const snk = stepsOf(s).find((x) => String(x.uses).startsWith('Platane/snk/'))
    expect(snk?.uses).toBe('Platane/snk/svg-only@d8f6715049803e982ee5ff501b6b9b7d5deeb09b')
    const outputs = String(obj(snk?.with, 'snk with').outputs)
    expect(outputs).toMatch(/snake-dark\.svg\?palette=github-dark/)
    expect(outputs).toMatch(/snake-light\.svg/)
    const up = stepsOf(s).find((x) => String(x.uses).startsWith('actions/upload-artifact@'))
    expect(up?.with).toMatchObject({ name: 'snake', 'if-no-files-found': 'error', 'include-hidden-files': false })
    expect(JSON.stringify(s)).not.toContain('PROFILE_REPO_TOKEN')
  })
  it('refresh: generate publishes a manifest hash; commit and profile verify it through env', () => {
    const j = Object.fromEntries(jobs('refresh.yml'))
    expect((j.generate as Obj).outputs).toEqual({ manifest_sha: '${{ steps.manifest.outputs.manifest_sha }}' })
    const gen = stepsOf(j.generate as Obj)
    const mi = gen.findIndex((s) => s.id === 'manifest')
    expect(mi).toBeGreaterThan(gen.findIndex((s) => String(s.run).startsWith('node scripts/refresh.ts')))
    expect(mi).toBeLessThan(gen.findIndex((s) => String(s.uses).startsWith('actions/upload-artifact@')))
    expect(String(gen[mi]?.run)).toContain('sha256sum')
    for (const [n, name] of [['commit', 'Commit to data branch'], ['profile', 'Push to profile repo']] as const) {
      const s = stepsOf(j[n] as Obj).find((x) => x.name === name)
      expect(obj(s?.env, 'env').MANIFEST_SHA, n).toBe('${{ needs.generate.outputs.manifest_sha }}')
      expect(String(s?.run), n).toContain('sha256sum -c')
    }
  })
  it('refresh: git tokens go through GIT_CONFIG_* env, never `git -c http.extraheader` (argv shows in ps)', () => {
    for (const n of ['commit', 'profile']) {
      const runs = stepsOf(Object.fromEntries(jobs('refresh.yml'))[n] as Obj).map((s) => String(s.run ?? '')).join('\n')
      expect(runs, n).not.toMatch(/-c\s+http\.extraheader/)
      expect(runs, n).toContain('GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraheader GIT_CONFIG_VALUE_0="$AUTH"')
    }
  })
  it('refresh: the profile PAT appears once, in the profile job only (SECURITY-RESEARCH "PAT")', () => {
    expect(raw('refresh.yml').match(/secrets\.PROFILE_REPO_TOKEN/g)).toHaveLength(1)
    for (const f of files) for (const [n, j] of jobs(f)) if (!(f === 'refresh.yml' && n === 'profile')) expect(JSON.stringify(j), `${f}:${n}`).not.toContain('PROFILE_REPO_TOKEN')
    const p = Object.fromEntries(jobs('refresh.yml')).profile as Obj
    const push = stepsOf(p).find((x) => x.name === 'Push to profile repo')
    expect(obj(push?.env, 'env').PROFILE_REPO_TOKEN).toBe('${{ secrets.PROFILE_REPO_TOKEN }}')
    expect(obj(push?.env, 'env').PROFILE_REPO_URL).toBe('https://github.com/LeongJinZhou/LeongJinZhou.git')
  })
  it('refresh: profile job runs only on main after generate, screenshots, snake; no npm, node, Playwright, checkout or third-party actions', () => {
    const p = Object.fromEntries(jobs('refresh.yml')).profile as Obj
    expect(p.needs).toEqual(['generate', 'screenshots', 'snake'])
    expect(p.if).toBe("github.ref == 'refs/heads/main'")
    expect(p.permissions).toEqual({ contents: 'read' })
    const steps = stepsOf(p)
    for (const s of steps.filter((x) => x.uses)) expect(String(s.uses)).toMatch(/^actions\/download-artifact@/)
    const runs = steps.map((s) => String(s.run ?? '')).join('\n')
    expect(runs).not.toMatch(/\b(npm|npx|node|playwright)\b/)
    expect(steps.filter((x) => x.uses).map((d) => obj(d.with, 'with').name).sort()).toEqual(['final', 'generated', 'snake'])
    expect(runs).toContain('http.extraheader')
    expect(runs).toContain('::add-mask::')
    expect(runs).toContain('::warning::')
    expect(runs).not.toMatch(/x-access-token:[^%]*@|https:\/\/[^ "]*:\$/) // token never in a URL
    expect(runs).toContain('git status --porcelain')
    expect(runs).toContain('chore: daily refresh')
  })
  it('refresh: screenshots job is read-only, secret-free, and feeds commit via artifact final', () => {
    const j = Object.fromEntries(jobs('refresh.yml'))
    const s = j.screenshots as Obj
    expect(s.needs).toBe('generate')
    expect(s.permissions).toEqual({ contents: 'read' })
    expect(JSON.stringify(s)).not.toMatch(/secrets\./)
    expect(JSON.stringify(s)).not.toContain('GITHUB_TOKEN')
    expect(s.outputs).toEqual({ failed: '${{ steps.shots.outputs.failed }}' })
    const steps = stepsOf(s)
    expect(steps.some((x) => x.run === 'npx playwright install --with-deps chromium')).toBe(true)
    expect(steps.find((x) => x.id === 'shots')?.run).toBe('node scripts/screenshots.ts generated previous/shots')
    const data = steps.find((x) => obj(x.with ?? {}, 'with').ref === 'data')
    expect(data?.['continue-on-error']).toBe(true)
    const up = steps.find((x) => String(x.uses).startsWith('actions/upload-artifact@'))
    expect(up?.with).toMatchObject({ name: 'final', 'if-no-files-found': 'error', 'include-hidden-files': false })
    const dls = stepsOf(j.commit as Obj).filter((x) => String(x.uses).startsWith('actions/download-artifact@'))
    expect(dls.map((d) => obj(d.with, 'with').name).sort()).toEqual(['final', 'generated'])
    const commitEnv = obj(stepsOf(j.commit as Obj).find((x) => x.name === 'Commit to data branch')?.env, 'env')
    expect(commitEnv.GENERATED).not.toBe(commitEnv.FINAL)
  })
  it('refresh: screenshots job lifts the AppArmor userns restriction before running Chromium', () => {
    const steps = stepsOf((Object.fromEntries(jobs('refresh.yml')).screenshots as Obj))
    const sysctl = steps.findIndex((x) => x.run === 'sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0')
    const run = steps.findIndex((x) => x.id === 'shots')
    expect(sysctl).toBeGreaterThan(-1)
    expect(sysctl).toBeLessThan(run)
  })
  it('ci: installs Chromium and lifts the AppArmor userns restriction before unit/integration tests', () => {
    const steps = jobs('ci.yml').flatMap(([, j]) => stepsOf(j))
    const at = (run: string) => steps.findIndex((x) => x.run === run)
    const tests = at('npm run test:coverage')
    expect(tests).toBeGreaterThan(-1)
    expect(at('sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0')).toBeGreaterThan(-1)
    expect(at('sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0')).toBeLessThan(tests)
    expect(at('npx playwright install --with-deps chromium')).toBeGreaterThan(-1)
    expect(at('npx playwright install --with-deps chromium')).toBeLessThan(tests)
  })
  it('refresh: verdict fails on screenshots failed=true, read through env', () => {
    const v = Object.fromEntries(jobs('refresh.yml')).verdict as Obj
    const st = stepsOf(v)[0] as Obj
    expect(obj(st.env, 'env').SHOTS_FAILED).toBe('${{ needs.screenshots.outputs.failed }}')
    expect(String(st.run)).toContain('"$SHOTS_FAILED" != true')
  })
  it('deploy.yml: triggers, no configure-pages, deploy job settings', () => {
    expect([...triggers('deploy.yml')].sort()).toEqual(['push', 'workflow_call', 'workflow_dispatch'])
    expect(raw('deploy.yml')).not.toContain('configure-pages')
    const j = Object.fromEntries(jobs('deploy.yml'))
    expect(j.build?.permissions).toEqual({ contents: 'read' })
    expect(j.deploy).toHaveProperty('environment.name', 'github-pages')
    expect(j.deploy).toHaveProperty('concurrency.cancel-in-progress', false)
  })
})
