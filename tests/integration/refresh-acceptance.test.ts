import { execFile } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 30_000 }) // cases spawn node refresh.ts (exec timeout 10 s); the 5 s default flakes on Windows under parallel load
import { startStub, type Mode, type Stub } from '../helpers/stub.ts'

// Acceptance tests: real CLI entry point -> config files -> GitHub client -> select -> projects.json.
const exec = promisify(execFile)
const script = fileURLToPath(new URL('../../scripts/refresh.ts', import.meta.url))
const realConfig = fileURLToPath(new URL('../../config', import.meta.url))
const expectedFile = fileURLToPath(new URL('../fixtures/expected/projects.json', import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'refresh-acc-'))
let cfg: string
let out: string
let stub: Stub

async function run(env: Record<string, string> = {}) {
  try {
    await exec(process.execPath, [script, out], {
      env: { ...process.env, CONFIG_DIR: cfg, GITHUB_API_URL: stub.url, GITHUB_TOKEN: 'tok-default', ...env },
      encoding: 'utf8',
      timeout: 10_000,
      killSignal: 'SIGKILL',
    })
    return 0
  } catch (e) {
    return (e as { code: number }).code
  }
}
const names = () => (JSON.parse(readFileSync(join(out, 'projects.json'), 'utf8')) as { name: string }[]).map((p) => p.name)
const hide = (...repos: string[]) => writeFileSync(join(cfg, 'hidden.txt'), repos.join('\n') + '\n')
const start = async (mode: Mode = 'ok') => {
  stub = await startStub(mode)
}

beforeEach(() => {
  const d = mkdtempSync(join(root, 'case-'))
  cfg = join(d, 'config')
  out = join(d, 'out')
  cpSync(realConfig, cfg, { recursive: true }) // real hidden.txt (empty), featured.txt, overrides
})
afterEach(() => stub.close())
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('S4: refresh rebuilds projects.json from recorded API responses', () => {
  it('output equals the hand-checked expected projects.json byte for byte (hidden-one hidden)', async () => {
    await start()
    hide('hidden-one')
    expect(await run()).toBe(0)
    const expected = readFileSync(expectedFile, 'utf8').replace(/\r\n/g, '\n')
    expect(readFileSync(join(out, 'projects.json'), 'utf8')).toBe(expected)
  })
  it('GITHUB_TOKEN env reaches every API request as a Bearer header', async () => {
    await start()
    expect(await run({ GITHUB_TOKEN: 'tok-env' })).toBe(0)
    expect(stub.seenAuth.length).toBeGreaterThanOrEqual(2 + 5) // 2 repo pages + 5 language calls
    expect(stub.seenAuth.every((a) => a === 'Bearer tok-env')).toBe(true)
  })
})

describe('S5: a new public repo shows after the next refresh', () => {
  it('repo added to the API response appears in projects.json, sorted by push', async () => {
    await start()
    expect(await run()).toBe(0)
    expect(names()).not.toContain('brand-new')
    stub.mode = 'new-repo'
    expect(await run()).toBe(0)
    expect(names()[0]).toBe('brand-new')
  })
})

describe('S6: hide-list file drives what is shown', () => {
  it('a repo shown with the real (empty) hidden.txt disappears once listed', async () => {
    await start()
    expect(await run()).toBe(0)
    expect(names()).toEqual(['qiu-cpdc-career-portal', 'qiu-ai-video-2026', 'hidden-one', 'Pocket-G', 'OCR1'])
    hide('hidden-one', 'pocket-g') // featured repo, different case
    expect(await run()).toBe(0)
    expect(names()).toEqual(['qiu-cpdc-career-portal', 'qiu-ai-video-2026', 'OCR1'])
  })
})

describe('S10 / rule 13: failures keep the last good data and exit non-zero', () => {
  it('malformed API body: file unchanged, exit 1', async () => {
    await start()
    expect(await run()).toBe(0)
    const before = readFileSync(join(out, 'projects.json'))
    stub.mode = 'malformed'
    expect(await run()).toBe(1)
    expect(readFileSync(join(out, 'projects.json')).equals(before)).toBe(true)
    expect(readdirSync(out)).toEqual(['profile', 'projects.json'])
  })
  it('every repo hidden (0 projects after filtering): file unchanged, exit 1', async () => {
    await start()
    expect(await run()).toBe(0)
    const before = readFileSync(join(out, 'projects.json'))
    hide('qiu-cpdc-career-portal', 'qiu-ai-video-2026', 'hidden-one', 'Pocket-G', 'OCR1')
    expect(await run()).toBe(1)
    expect(readFileSync(join(out, 'projects.json')).equals(before)).toBe(true)
  })
  it('API down on first ever run: no out dir created, exit 1', async () => {
    await start('error500')
    expect(await run()).toBe(1)
    expect(existsSync(out)).toBe(false)
  })
})
