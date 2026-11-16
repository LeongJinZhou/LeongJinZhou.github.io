// refresh.ts CLI against recorded GitHub responses: the generated profile (S4, S7, rules 11, 13).
import { execFile } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { startStub, type Mode, type Stub } from '../helpers/stub.ts'
import { assertWellFormedXml } from '../helpers/xml.ts'

vi.setConfig({ testTimeout: 60_000 }) // each case spawns node refresh.ts (up to twice); the 5 s default flakes on Windows under parallel load
const exec = promisify(execFile)
const script = fileURLToPath(new URL('../../scripts/refresh.ts', import.meta.url))
const realConfig = fileURLToPath(new URL('../../config', import.meta.url))
const expectedDir = fileURLToPath(new URL('../fixtures/expected/profile', import.meta.url))
const FILES = ['README.md', 'assets/banner.svg', 'assets/langs-dark.svg', 'assets/langs-light.svg', 'assets/stats-dark.svg', 'assets/stats-light.svg']

let root: string
let cfg: string
let out: string
let stub: Stub

async function run(env: Record<string, string> = {}) {
  try {
    await exec(process.execPath, [script, out], {
      env: { ...process.env, CONFIG_DIR: cfg, GITHUB_API_URL: stub.url, GITHUB_TOKEN: 'tok-default', ...env },
      encoding: 'utf8', timeout: 20_000, killSignal: 'SIGKILL',
    })
    return 0
  } catch (e) {
    return (e as { code: number }).code
  }
}
const start = async (mode: Mode = 'ok') => {
  stub = await startStub(mode)
}
const read = (...p: string[]) => readFileSync(join(out, 'profile', ...p), 'utf8')

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'profile-gen-'))
  cfg = join(root, 'config')
  cpSync(realConfig, cfg, { recursive: true })
})
afterEach(async () => {
  await stub.close()
  rmSync(out, { recursive: true, force: true })
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('S4: profile files rebuilt from recorded responses', () => {
  it('writes README and SVGs byte-equal to the hand-checked fixtures', async () => {
    await start()
    out = mkdtempSync(join(root, 'out-'))
    expect(await run({ GITHUB_TOKEN: 'tok' })).toBe(0)
    for (const f of FILES) expect(read(f), f).toBe(readFileSync(join(expectedDir, f), 'utf8'))
    expect(stub.graphql).toHaveLength(1)
    expect(stub.graphql[0]).toContain('user(login:\\"LeongJinZhou\\")')
    expect(stub.graphql[0]).not.toContain('viewer')
    expect(stub.seenAuth.at(-1)).toBe('Bearer tok')
  })
  it('is deterministic (rule 14)', async () => {
    await start()
    out = mkdtempSync(join(root, 'out-'))
    await run()
    const first = FILES.map((f) => read(f))
    await run()
    expect(FILES.map((f) => read(f))).toEqual(first)
  })
  it.each(['graphql-errors', 'graphql-null-user', 'graphql-partial-errors', 'error500'] as const)('%s: exit non-zero and nothing is written (rule 13)', async (mode) => {
    await start(mode)
    out = mkdtempSync(join(root, 'out-'))
    expect(await run()).not.toBe(0)
    expect(readdirSync(out)).toEqual([])
  })
})

describe('rule 11: generated SVGs', () => {
  it('all parse as XML and reference nothing external', async () => {
    await start()
    out = mkdtempSync(join(root, 'out-'))
    await run()
    for (const f of FILES.filter((f) => f.endsWith('.svg'))) {
      const svg = read(f)
      assertWellFormedXml(svg)
      expect(svg.replace('http://www.w3.org/2000/svg', ''), f).not.toMatch(/https?:|<script|<image|href=|url\(/i)
    }
  })
})

describe('S7: every relative image or link in the generated README resolves', () => {
  it('points at files that exist once the snake and screenshots are added', async () => {
    await start()
    out = mkdtempSync(join(root, 'out-'))
    await run()
    const md = read('README.md')
    const projects = JSON.parse(readFileSync(join(out, 'projects.json'), 'utf8')) as { name: string; screenshot: string; featured: boolean }[]
    // The snake and screenshots jobs add these before the profile push.
    const available = new Set([
      ...FILES.filter((f) => f !== 'README.md'),
      'assets/snake-dark.svg',
      'assets/snake-light.svg',
      ...projects.map((p) => `assets/shots/${p.screenshot}`),
    ])
    const refs = [...md.matchAll(/(?:src|srcset|href)="([^"]+)"|\]\(([^)\s]+)\)/g)].map((m) => m[1] ?? m[2] ?? '')
    const relative = refs.filter((r) => !/^(https?:|#|mailto:)/.test(r))
    expect(relative.length).toBeGreaterThanOrEqual(10)
    for (const r of relative) expect(available.has(r), r).toBe(true)
    for (const need of ['assets/banner.svg', 'assets/stats-dark.svg', 'assets/langs-light.svg', 'assets/snake-dark.svg', 'assets/shots/qiu-cpdc-career-portal.webp'])
      expect(relative, need).toContain(need)
    expect(md).not.toMatch(/linkedin/i) // rule 17: URL unset in config/site.json
    expect(existsSync(join(out, 'profile', 'assets', 'snake-dark.svg'))).toBe(false) // snake comes from its own job
  })
})
