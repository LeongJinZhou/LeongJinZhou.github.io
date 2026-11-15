// Runs the real refresh.yml "Commit to data branch" script against a local bare repo.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

type Step = { name?: string; run?: string; env?: Record<string, string> }
const wf = parse(readFileSync(fileURLToPath(new URL('../../.github/workflows/refresh.yml', import.meta.url)), 'utf8'))
const step = (wf.jobs.commit.steps as Step[]).find((s) => s.name === 'Commit to data branch')
const script = step?.run ?? ''

// On Windows prefer Git Bash: a bare "bash" can resolve to WSL, which cannot see these paths.
const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
const bash = process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'bash'
const hasBash = spawnSync(bash, ['-c', 'git --version'], { encoding: 'utf8' }).status === 0
const slash = (p: string) => p.replace(/\\/g, '/')

const PROJECTS = '{"projects":[]}\n'
const SHOT = 'fake-png'
const TOKEN = 'ghs_faketoken000000000000000000000000'

let tmp: string
let remote: string
let gitEnv: NodeJS.ProcessEnv
let n = 0

const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: gitEnv }).trim()

function artifact(extra: (dir: string) => void = () => {}) {
  const dir = join(tmp, `gen-${n++}`)
  mkdirSync(join(dir, 'shots'), { recursive: true })
  writeFileSync(join(dir, 'projects.json'), PROJECTS)
  writeFileSync(join(dir, 'shots', 'a.png'), SHOT)
  extra(dir)
  return dir
}

function runJob(generated: string) {
  const cwd = mkdtempSync(join(tmp, 'runner-'))
  const r = spawnSync(bash, ['-c', script], {
    cwd,
    encoding: 'utf8',
    env: { ...gitEnv, GH_TOKEN: TOKEN, REPO_URL: `file://${slash(remote).startsWith('/') ? '' : '/'}${slash(remote)}`, GENERATED: slash(generated) },
  })
  return { ...r, work: join(cwd, 'work') }
}

const commits = () => git(remote, 'rev-list', '--count', 'data')
const tree = () => git(remote, 'ls-tree', '-r', '--name-only', 'data').split('\n').sort()

describe('refresh.yml commit job script', () => {
  it('is present in the workflow with the env it relies on', () => {
    expect(script).toContain('set -euo pipefail')
    expect(Object.keys(step?.env ?? {}).sort()).toEqual(['GENERATED', 'GH_TOKEN', 'REPO_URL'])
  })
})

describe.skipIf(!hasBash)('refresh.yml commit job against a local bare remote', () => {
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'commit-job-'))
    const emptyCfg = join(tmp, 'gitconfig')
    writeFileSync(emptyCfg, '')
    // Isolate from the developer's git config (signing, hooks, autocrlf).
    gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: emptyCfg, GIT_CONFIG_NOSYSTEM: '1' }
    remote = join(tmp, 'remote.git')
    execFileSync('git', ['init', '-q', '--bare', remote], { env: gitEnv })
  })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('first run creates orphan data branch with one "chore: daily refresh" commit', () => {
    const r = runJob(artifact((d) => writeFileSync(join(d, 'extra.txt'), 'not allowlisted')))
    expect(r.status, r.stderr).toBe(0)
    expect(commits()).toBe('1')
    expect(git(remote, 'log', '-1', '--format=%s|%an|%P', 'data')).toBe('chore: daily refresh|github-actions[bot]|')
    expect(git(remote, 'show', 'data:projects.json') + '\n').toBe(PROJECTS)
    expect(git(remote, 'show', 'data:shots/a.png')).toBe(SHOT)
    // Non-allowlisted artifact file is not copied.
    expect(tree()).toEqual(['projects.json', 'shots/a.png'])
    // Token never lands in the repo config or remote URL.
    expect(readFileSync(join(r.work, '.git', 'config'), 'utf8')).not.toContain(TOKEN)
    expect(r.stdout + r.stderr).not.toContain(TOKEN)
  })

  it('second identical run commits nothing', () => {
    const before = git(remote, 'rev-parse', 'data')
    const r = runJob(artifact())
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain('No changes; nothing to commit.')
    expect(git(remote, 'rev-parse', 'data')).toBe(before)
    expect(commits()).toBe('1')
  })

  it('changed data adds one commit on top and drops removed files', () => {
    const before = git(remote, 'rev-parse', 'data')
    const r = runJob(
      artifact((d) => {
        rmSync(join(d, 'shots', 'a.png'))
        writeFileSync(join(d, 'shots', 'b.png'), 'new')
      }),
    )
    expect(r.status, r.stderr).toBe(0)
    expect(commits()).toBe('2')
    expect(git(remote, 'rev-parse', 'data~1')).toBe(before)
    expect(tree()).toEqual(['projects.json', 'shots/b.png'])
  })

  it('rejects an artifact with a hidden file and pushes nothing', () => {
    const before = git(remote, 'rev-parse', 'data')
    const r = runJob(artifact((d) => writeFileSync(join(d, 'shots', '.hidden'), 'x')))
    expect(r.status).not.toBe(0)
    expect(r.stdout).toContain('::error::Artifact contains a symlink or hidden file.')
    expect(git(remote, 'rev-parse', 'data')).toBe(before)
  })

  // Many entries make find write past grep -q's exit (SIGPIPE + pipefail) - the check must still fail closed.
  it('rejects a hidden file even when the artifact has many entries', () => {
    const before = git(remote, 'rev-parse', 'data')
    const r = runJob(
      artifact((d) => {
        for (let i = 0; i < 3000; i++) writeFileSync(join(d, 'shots', `.h${String(i).padStart(60, '0')}`), '')
      }),
    )
    expect(r.status).not.toBe(0)
    expect(git(remote, 'rev-parse', 'data')).toBe(before)
  }, 60_000)

  it("rejects a non-image file in shots/ and pushes nothing", () => {
    const before = git(remote, "rev-parse", "data")
    const r = runJob(artifact((d) => writeFileSync(join(d, "shots", "evil.html"), "<script></script>")))
    expect(r.status).not.toBe(0)
    expect(r.stdout).toContain("::error::shots/ may only contain .webp and .png files.")
    expect(git(remote, "rev-parse", "data")).toBe(before)
  })

  let canLink = true
  try {
    const p = mkdtempSync(join(tmpdir(), 'lnk-'))
    symlinkSync(join(p, 'x'), join(p, 'y'))
    rmSync(p, { recursive: true, force: true })
  } catch {
    canLink = false
  }
  it.skipIf(!canLink)('rejects an artifact with a symlink and pushes nothing', () => {
    const before = git(remote, 'rev-parse', 'data')
    const r = runJob(artifact((d) => symlinkSync(join(d, 'projects.json'), join(d, 'shots', 'link.png'))))
    expect(r.status).not.toBe(0)
    expect(r.stdout).toContain('::error::Artifact contains a symlink or hidden file.')
    expect(git(remote, 'rev-parse', 'data')).toBe(before)
  })
})
