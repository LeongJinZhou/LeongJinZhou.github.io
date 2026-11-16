// Runs the real refresh.yml "Push to profile repo" script against a local bare repo (rule 14, SECURITY-RESEARCH "PAT").
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { writeManifest } from '../helpers/manifest.ts'

vi.setConfig({ testTimeout: 30_000 }) // each case spawns bash + several git processes; slow on Windows

type Step = { name?: string; run?: string; env?: Record<string, string> }
const wf = parse(readFileSync(fileURLToPath(new URL('../../.github/workflows/refresh.yml', import.meta.url)), 'utf8'))
const step = (wf.jobs.profile.steps as Step[]).find((s) => s.name === 'Push to profile repo')
const script = step?.run ?? ''

// On Windows prefer Git Bash: a bare "bash" can resolve to WSL, which cannot see these paths.
const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
const bash = process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'bash'
const hasBash = spawnSync(bash, ['-c', 'git --version'], { encoding: 'utf8' }).status === 0
const slash = (p: string) => p.replace(/\\/g, '/')

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')])
const SVG = (t: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><text>${t}</text></svg>`
const TOKEN = 'github_pat_faketoken0000000000000000'
const GEN_FILES = ['banner', 'stats-dark', 'stats-light', 'langs-dark', 'langs-light']

let tmp: string
let remote: string
let gitEnv: NodeJS.ProcessEnv
let n = 0

const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: gitEnv }).trim()

interface Dirs { generated: string; final: string; snake: string }

function inputs(tag = 'v1', extra: (d: Dirs) => void = () => {}): Dirs {
  const base = join(tmp, `in-${n++}`)
  const d = { generated: join(base, 'generated'), final: join(base, 'final'), snake: join(base, 'snake') }
  mkdirSync(join(d.generated, 'profile', 'assets'), { recursive: true })
  mkdirSync(join(d.final, 'shots'), { recursive: true })
  mkdirSync(d.snake, { recursive: true })
  writeFileSync(join(d.generated, 'profile', 'README.md'), `# readme ${tag}\n`)
  for (const f of GEN_FILES) writeFileSync(join(d.generated, 'profile', 'assets', `${f}.svg`), SVG(`${f} ${tag}`))
  writeFileSync(join(d.final, 'shots', 'a.webp'), Buffer.concat([WEBP, Buffer.from(tag)]))
  for (const f of ['snake-dark', 'snake-light']) writeFileSync(join(d.snake, `${f}.svg`), SVG(`${f} ${tag}`))
  extra(d)
  return d
}

// The manifest is written after the inputs are built (like the generate job); `tamper` then simulates a swapped artifact.
function runJob(d: Dirs, env: Record<string, string> = {}, tamper?: (generated: string) => void) {
  const manifestSha = writeManifest(d.generated)
  tamper?.(d.generated)
  const cwd = mkdtempSync(join(tmp, 'runner-'))
  const r = spawnSync(bash, ['-c', script], {
    cwd,
    encoding: 'utf8',
    env: {
      ...gitEnv,
      PROFILE_REPO_TOKEN: TOKEN,
      PROFILE_REPO_URL: `file://${slash(remote).startsWith('/') ? '' : '/'}${slash(remote)}`,
      GENERATED: slash(d.generated), FINAL: slash(d.final), SNAKE: slash(d.snake), MANIFEST_SHA: manifestSha,
      ...env,
    },
  })
  return { ...r, work: join(cwd, 'work') }
}

const head = () => git(remote, 'rev-parse', 'main')
const commits = () => git(remote, 'rev-list', '--count', 'main')
const tree = () => git(remote, 'ls-tree', '-r', '--name-only', 'main').split('\n').sort()
const FULL_TREE = [
  'README.md', 'assets/banner.svg', 'assets/langs-dark.svg', 'assets/langs-light.svg', 'assets/shots/a.webp',
  'assets/snake-dark.svg', 'assets/snake-light.svg', 'assets/stats-dark.svg', 'assets/stats-light.svg',
]

describe('refresh.yml profile job script', () => {
  it('is present with the env it relies on', () => {
    expect(script).toContain('set -euo pipefail')
    expect(Object.keys(step?.env ?? {}).sort()).toEqual(['FINAL', 'GENERATED', 'MANIFEST_SHA', 'PROFILE_REPO_TOKEN', 'PROFILE_REPO_URL', 'SNAKE'])
    expect(step?.env?.MANIFEST_SHA).toBe('${{ needs.generate.outputs.manifest_sha }}')
  })
})

describe.skipIf(!hasBash)('refresh.yml profile job against a local bare remote', () => {
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'profile-job-'))
    const emptyCfg = join(tmp, 'gitconfig')
    writeFileSync(emptyCfg, '')
    gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: emptyCfg, GIT_CONFIG_NOSYSTEM: '1' }
    remote = join(tmp, 'remote.git')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote], { env: gitEnv })
  })
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('empty token: ::warning::, exit 0, nothing pushed', () => {
    const r = runJob(inputs(), { PROFILE_REPO_TOKEN: '' })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain('::warning::')
    expect(git(remote, 'for-each-ref')).toBe('')
  })

  it('first run creates main with one "chore: daily refresh" commit; README and SVGs from generated, shots from final, snake from snake', () => {
    const d = inputs('v1', (x) => {
      // The screenshots job also uploads a copy of profile/: it is untrusted and must be ignored.
      mkdirSync(join(x.final, 'profile'), { recursive: true })
      writeFileSync(join(x.final, 'profile', 'README.md'), 'TAMPERED')
      writeFileSync(join(x.generated, 'projects.json'), '{}')
    })
    const r = runJob(d)
    expect(r.status, r.stderr + r.stdout).toBe(0)
    expect(commits()).toBe('1')
    expect(git(remote, 'log', '-1', '--format=%s|%an|%P', 'main')).toBe('chore: daily refresh|github-actions[bot]|')
    expect(tree()).toEqual(FULL_TREE)
    expect(git(remote, 'show', 'main:README.md')).toBe('# readme v1')
    // Token never lands in the repo config, remote URL, or logs.
    expect(readFileSync(join(r.work, '.git', 'config'), 'utf8')).not.toContain(TOKEN)
    expect(r.stdout + r.stderr).not.toContain(TOKEN)
  })

  it('identical second run commits nothing (rule 14)', () => {
    const before = head()
    const r = runJob(inputs('v1'))
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain('No changes; nothing to commit.')
    expect(head()).toBe(before)
  })

  it('changed content adds one commit, drops stale generated files, keeps unrelated files', () => {
    const clone = join(tmp, 'clone')
    execFileSync('git', ['clone', '-q', remote, clone], { env: gitEnv })
    writeFileSync(join(clone, 'LICENSE'), 'MIT')
    mkdirSync(join(clone, 'assets', 'shots'), { recursive: true })
    writeFileSync(join(clone, 'assets', 'shots', 'old.webp'), WEBP)
    git(clone, 'add', '-A')
    git(clone, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'manual')
    git(clone, 'push', '-q', 'origin', 'main')
    const before = head()
    const r = runJob(inputs('v2'))
    expect(r.status, r.stderr + r.stdout).toBe(0)
    expect(git(remote, 'rev-parse', 'main~1')).toBe(before)
    expect(tree()).toEqual(['LICENSE', ...FULL_TREE].sort())
    expect(git(remote, 'show', 'main:README.md')).toBe('# readme v2')
  })

  const rejects: [string, (d: Dirs) => void, string][] = [
    ['a hidden file in shots', (d) => writeFileSync(join(d.final, 'shots', '.hidden'), 'x'), 'symlink or hidden'],
    ['a hidden file in the snake dir', (d) => writeFileSync(join(d.snake, '.x'), 'x'), 'symlink or hidden'],
    ['a hidden file in generated/profile', (d) => writeFileSync(join(d.generated, 'profile', '.x'), 'x'), 'symlink or hidden'],
    ['a non-image in shots', (d) => writeFileSync(join(d.final, 'shots', 'evil.html'), '<script></script>'), 'shots/'],
    ['a .webp that is really HTML', (d) => writeFileSync(join(d.final, 'shots', 'x.webp'), '<html></html>'), 'not a valid'],
    ['a .png with a bad signature', (d) => writeFileSync(join(d.final, 'shots', 'y.png'), 'fake-png'), 'not a valid'],
    ['a shot over 2 MB', (d) => writeFileSync(join(d.final, 'shots', 'big.webp'), Buffer.concat([WEBP, Buffer.alloc(2 * 1024 * 1024)])), '2 MB'],
    ['a snake svg with a script', (d) => writeFileSync(join(d.snake, 'snake-dark.svg'), SVG('x').replace('<text>', '<script>alert(1)</script><text>')), 'snake-dark.svg'],
    ['a snake file that is not an svg', (d) => writeFileSync(join(d.snake, 'snake-light.svg'), 'plain text'), 'snake-light.svg'],
    ['a snake svg over 2 MB', (d) => writeFileSync(join(d.snake, 'snake-light.svg'), SVG('x') + ' '.repeat(2 * 1024 * 1024)), '2 MB'],
    ['a missing snake file', (d) => rmSync(join(d.snake, 'snake-dark.svg')), 'snake-dark.svg'],
    ['a snake svg with an event handler', (d) => writeFileSync(join(d.snake, 'snake-dark.svg'), SVG('x').replace('<text>', '<rect onload="alert(1)"/><text>')), 'active content'],
    ['a snake svg with foreignObject', (d) => writeFileSync(join(d.snake, 'snake-light.svg'), SVG('x').replace('<text>', '<foreignObject></foreignObject><text>')), 'active content'],
    ['a generated svg with a javascript: link', (d) => writeFileSync(join(d.generated, 'profile', 'assets', 'stats-dark.svg'), SVG('x').replace('<text>', '<a href="javascript:alert(1)"><text>y</text></a><text>')), 'active content'],
    ['a generated svg with a script',(d) => writeFileSync(join(d.generated, 'profile', 'assets', 'banner.svg'), '<svg><script></script></svg>'), 'banner.svg'],
    ['a missing README', (d) => rmSync(join(d.generated, 'profile', 'README.md')), 'README.md'],
    // SVG allowlist: any reference, import, entity, declaration or unlisted element is refused.
    ['a snake svg with href', (d) => writeFileSync(join(d.snake, 'snake-dark.svg'), SVG('x').replace('<text>', '<a HREF="https://x.test"><text>y</text></a><text>')), 'active content'],
    ['a snake svg with xlink:href', (d) => writeFileSync(join(d.snake, 'snake-dark.svg'), SVG('x').replace('<text>', '<use xlink:href="#a"/><text>')), 'active content'],
    ['a snake svg with url()', (d) => writeFileSync(join(d.snake, 'snake-dark.svg'), SVG('x').replace('<text>', '<rect fill="url(#g)"/><text>')), 'active content'],
    ['a snake svg with @import', (d) => writeFileSync(join(d.snake, 'snake-dark.svg'), SVG('x').replace('<text>', '<style>@import "x.css";</style><text>')), 'active content'],
    ['a snake svg with a numeric entity', (d) => writeFileSync(join(d.snake, 'snake-dark.svg'), SVG('x').replace('<text>', '<text>&#106;')), 'active content'],
    ['a snake svg with a comment', (d) => writeFileSync(join(d.snake, 'snake-dark.svg'), SVG('x').replace('<text>', '<!-- x --><text>')), 'active content'],
    ['a snake svg with a doctype', (d) => writeFileSync(join(d.snake, 'snake-dark.svg'), '<!DOCTYPE svg>' + SVG('x')), 'active content'],
    ['a snake svg with an image element', (d) => writeFileSync(join(d.snake, 'snake-dark.svg'), SVG('x').replace('<text>', '<IMAGE/><text>')), 'active content'],
    ['a snake svg with an iframe element', (d) => writeFileSync(join(d.snake, 'snake-dark.svg'), SVG('x').replace('<text>', '<iframe></iframe><text>')), 'active content'],
    ['a generated svg with a use element', (d) => writeFileSync(join(d.generated, 'profile', 'assets', 'langs-dark.svg'), SVG('x').replace('<text>', '<use/><text>')), 'active content'],
  ]
  it.each(rejects)('rejects %s and pushes nothing', (_name, mutate, msg) => {
    const before = head()
    const r = runJob(inputs('v3', mutate))
    expect(r.status).not.toBe(0)
    expect(r.stdout).toContain('::error::')
    expect(r.stdout).toContain(msg)
    expect(head()).toBe(before)
  })

  // Artifact poisoning: `generated` must be exactly what the generate job wrote (manifest hash comes through the job graph).
  it.each<[string, (g: string) => void]>([
    ['a tampered README', (g) => writeFileSync(join(g, 'profile', 'README.md'), '# TAMPERED\n')],
    ['a tampered svg', (g) => appendFileSync(join(g, 'profile', 'assets', 'banner.svg'), ' ')],
    ['an extra file', (g) => writeFileSync(join(g, 'profile', 'extra.md'), 'x')],
    ['an extra file at the root', (g) => writeFileSync(join(g, 'extra.txt'), 'x')],
    ['a tampered manifest', (g) => appendFileSync(join(g, 'MANIFEST.sha256'), '\n')],
    ['a missing manifest', (g) => rmSync(join(g, 'MANIFEST.sha256'))],
  ])('rejects %s and pushes nothing', (_name, tamper) => {
    const before = head()
    const r = runJob(inputs('v8'), {}, tamper)
    expect(r.status).not.toBe(0)
    expect(r.stdout).toContain('::error::Generated artifact')
    expect(head()).toBe(before)
  })
  it('rejects a manifest hash that does not match', () => {
    const before = head()
    const r = runJob(inputs('v8'), { MANIFEST_SHA: 'b'.repeat(64) })
    expect(r.status).not.toBe(0)
    expect(r.stdout).toContain('::error::Generated artifact')
    expect(head()).toBe(before)
  })

  it('accepts a snake-shaped svg (desc, style with CSS animation, many rects) and our own generated svgs', () => {
    const snk =
      '<svg viewBox="-16 -32 880 192" width="880" height="192" xmlns="http://www.w3.org/2000/svg"><desc>Generated with https://github.com/Platane/snk</desc>' +
      '<style>:root{--c0:#ebedf0}.c{shape-rendering:geometricPrecision;fill:var(--c0)}@keyframes s{0%{transform:translate(0,0)}100%{transform:translate(16px,0)}}.s{animation:s 5s linear infinite}</style>' +
      '<rect class="c" x="0" y="0" width="12" height="12" rx="2"/><rect class="s" x="1" y="1" width="10" height="10"/></svg>'
    const r = runJob(inputs('v9', (d) => writeFileSync(join(d.snake, 'snake-dark.svg'), snk)))
    expect(r.status, r.stdout + r.stderr).toBe(0)
  })

  it('accepts a valid WebP of exactly 2 MB and a valid PNG', () => {
    const r = runJob(
      inputs('v4', (d) => {
        writeFileSync(join(d.final, 'shots', 'ok.webp'), Buffer.concat([WEBP, Buffer.alloc(2 * 1024 * 1024 - WEBP.length)]))
        writeFileSync(join(d.final, 'shots', 'ok.png'), Buffer.concat([PNG_SIG, Buffer.from('png')]))
      }),
    )
    expect(r.status, r.stderr + r.stdout).toBe(0)
    expect(tree()).toEqual(expect.arrayContaining(['assets/shots/ok.webp', 'assets/shots/ok.png']))
  })

  it('ignores snake-dir files other than the two named ones', () => {
    const r = runJob(inputs('v5', (d) => writeFileSync(join(d.snake, 'extra.svg'), SVG('x'))))
    expect(r.status, r.stderr + r.stdout).toBe(0)
    expect(tree()).not.toContain('assets/extra.svg')
  })

  let canLink = true
  try {
    const p = mkdtempSync(join(tmpdir(), 'lnk-'))
    symlinkSync(join(p, 'x'), join(p, 'y'))
    rmSync(p, { recursive: true, force: true })
  } catch {
    canLink = false
  }
  it.skipIf(!canLink)('rejects a symlink and pushes nothing', () => {
    const before = head()
    const r = runJob(inputs('v6', (d) => symlinkSync(join(d.generated, 'profile', 'README.md'), join(d.final, 'shots', 'link.png'))))
    expect(r.status).not.toBe(0)
    expect(r.stdout).toContain('::error::Artifact contains a symlink or hidden file.')
    expect(head()).toBe(before)
  })

  it('rejects a bad push (unreachable remote) with a non-zero exit', () => {
    const r = runJob(inputs('v7'), { PROFILE_REPO_URL: `file:///${slash(tmp)}/does-not-exist.git` })
    expect(r.status).not.toBe(0)
  })
})
