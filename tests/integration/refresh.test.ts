import { execFile } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 30_000 }) // cases spawn node refresh.ts (exec timeout 10 s); the 5 s default flakes on Windows under parallel load
import { loadOverrides, refresh } from '../../scripts/refresh.ts'
import { ProjectSchema } from '../../scripts/lib/schemas.ts'
import { startStub, type Stub } from '../helpers/stub.ts'

const exec = promisify(execFile)
const script = fileURLToPath(new URL('../../scripts/refresh.ts', import.meta.url))
const realConfig = fileURLToPath(new URL('../../config', import.meta.url))
let tmp: string
let cfg: string
let out: string
let stub: Stub

// Async spawn: the stub server lives in this process, so a sync spawn would deadlock it.
async function node(args: string[], env: NodeJS.ProcessEnv) {
  try {
    const r = await exec(process.execPath, args, { env, encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL' })
    return { status: 0, stdout: r.stdout, stderr: r.stderr }
  } catch (e) {
    const x = e as { code: number; stdout: string; stderr: string }
    return { status: x.code, stdout: x.stdout, stderr: x.stderr }
  }
}

const run = (env: Record<string, string> = {}) =>
  node([script, out], { ...process.env, CONFIG_DIR: cfg, GITHUB_API_URL: stub.url, GITHUB_TOKEN: 'tok-default', ...env })

const setup = async (mode: Parameters<typeof startStub>[0]) => {
  stub = await startStub(mode)
  out = mkdtempSync(join(tmp, 'out-'))
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'refresh-'))
  cfg = join(tmp, 'config')
  cpSync(realConfig, cfg, { recursive: true })
  writeFileSync(join(cfg, 'hidden.txt'), 'hidden-one\n')
})
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
afterEach(async () => {
  await stub.close()
  rmSync(out, { recursive: true, force: true })
})

describe('refresh.ts child process (S4, S5, S10, rule 13)', () => {
  it('writes projects.json: filtered, sorted, featured, overridden (S4)', async () => {
    await setup('ok')
    const r = await run({ GITHUB_TOKEN: 'tok-should-not-print' })
    expect(r.status).toBe(0)
    expect(r.stdout + r.stderr).not.toContain('tok-should-not-print')
    const projects = JSON.parse(readFileSync(join(out, 'projects.json'), 'utf8')) as unknown[]
    expect(() => projects.map((p) => ProjectSchema.parse(p))).not.toThrow()
    const list = projects as { name: string; title: string; featured: boolean; homepage: string | null }[]
    expect(list.map((p) => p.name)).toEqual(['qiu-cpdc-career-portal', 'qiu-ai-video-2026', 'Pocket-G', 'OCR1'])
    expect(list[0]).toMatchObject({
      title: 'QIU CPDC Career Portal',
      featured: true,
      languages: { TypeScript: 9000, CSS: 500 },
    })
    expect(list[1]).toMatchObject({ title: 'qiu-ai-video-2026', featured: false, homepage: null })
    expect(readdirSync(out)).toEqual(['profile', 'projects.json'])
  })
  it('is deterministic: second run is byte-identical (rule 14)', async () => {
    await setup('ok')
    await run()
    const first = readFileSync(join(out, 'projects.json'))
    await run()
    expect(readFileSync(join(out, 'projects.json')).equals(first)).toBe(true)
  })
  it.each(['error500', 'empty', 'languages500', 'readme500'] as const)('%s: output untouched, exit non-zero (S10)', async (mode) => {
    await setup('ok')
    expect((await run()).status).toBe(0)
    const before = readFileSync(join(out, 'projects.json'))
    stub.mode = mode
    const r = await run({ GITHUB_TOKEN: 'tok-should-not-print' })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('refresh failed')
    expect(r.stderr).not.toContain('tok-should-not-print')
    expect(readFileSync(join(out, 'projects.json')).equals(before)).toBe(true)
    expect(readdirSync(out)).toEqual(['profile', 'projects.json'])
  })
  it('malicious README is sanitised in projects.json; relative URLs use the default branch (S3, rule 7)', async () => {
    await setup('ok')
    expect((await run()).status).toBe(0)
    const raw = readFileSync(join(out, 'projects.json'), 'utf8')
    const list = JSON.parse(raw) as { name: string; readmeHtml: string }[]
    const by = (n: string) => list.find((p) => p.name === n)?.readmeHtml ?? ''
    for (const bad of ['<script', 'onerror', 'javascript:', 'data:image', 'evil.test']) expect(raw).not.toContain(bad)
    expect(by('Pocket-G')).toContain('safe text')
    expect(by('qiu-cpdc-career-portal')).toContain('src="https://raw.githubusercontent.com/LeongJinZhou/qiu-cpdc-career-portal/trunk/docs/shot.png"')
    expect(by('qiu-cpdc-career-portal')).toContain('href="https://github.com/LeongJinZhou/qiu-cpdc-career-portal/blob/trunk/docs/GUIDE.md"')
    expect(by('OCR1')).toBe('') // 404 -> missing README
  })
  it('error with no previous file creates nothing', async () => {
    await setup('error500')
    expect((await run()).status).not.toBe(0)
    expect(existsSync(join(out, 'projects.json'))).toBe(false)
  })
  it.each(['', undefined])('GITHUB_TOKEN %j: exit non-zero before any request or write, clear message', async (tok) => {
    await setup('ok')
    const env: NodeJS.ProcessEnv = { ...process.env, CONFIG_DIR: cfg, GITHUB_API_URL: stub.url }
    if (tok === undefined) delete env.GITHUB_TOKEN
    else env.GITHUB_TOKEN = tok
    const r = await node([script, out], env)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('GITHUB_TOKEN is required (GraphQL stats)')
    expect(readdirSync(out)).toEqual([])
    expect(stub.seenAuth).toEqual([])
  })
  it('no out dir: usage error, exit 2', async () => {
    await setup('ok')
    const r = await node([script], { ...process.env, OUT_DIR: '' })
    expect(r.status).toBe(2)
  })
})

describe('refresh() in process', () => {
  it('loadOverrides: __proto__ file is an own key, not the prototype', async () => {
    await setup('ok')
    const d = join(tmp, 'protocfg')
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, '__proto__.json'), '{"title":"X"}')
    const o = loadOverrides(d)
    expect(Object.hasOwn(o, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(o)).toBeNull()
  })
  it('creates the out dir and returns the project count', async () => {
    await setup('ok')
    const nested = join(out, 'a', 'b')
    expect(await refresh({ outDir: nested, configDir: cfg, baseUrl: stub.url })).toBe(4)
    expect(existsSync(join(nested, 'projects.json'))).toBe(true)
    expect(existsSync(join(nested, 'projects.json.tmp'))).toBe(false)
  })
  it('a failed write leaves no partial profile/ and no temp files', async () => {
    await setup('ok')
    // projects.json is a non-empty directory, so the final rename fails.
    mkdirSync(join(out, 'projects.json'), { recursive: true })
    writeFileSync(join(out, 'projects.json', 'keep'), 'x')
    await expect(refresh({ outDir: out, configDir: cfg, baseUrl: stub.url })).rejects.toThrow()
    expect(readdirSync(out)).toEqual(['projects.json'])
  })
  it('a second run replaces profile/ wholesale (no stale file survives)', async () => {
    await setup('ok')
    expect(await refresh({ outDir: out, configDir: cfg, baseUrl: stub.url })).toBe(4)
    writeFileSync(join(out, 'profile', 'stale.txt'), 'x')
    await refresh({ outDir: out, configDir: cfg, baseUrl: stub.url })
    expect(existsSync(join(out, 'profile', 'stale.txt'))).toBe(false)
    expect(readdirSync(out).sort()).toEqual(['profile', 'projects.json'])
  })
  it('featured fork reaches projects.json; unlisted fork stays out (S6, rules 1, 4)', async () => {
    await setup('ok')
    const withFork = join(tmp, 'forkcfg')
    cpSync(cfg, withFork, { recursive: true })
    writeFileSync(join(withFork, 'featured.txt'), readFileSync(join(cfg, 'featured.txt'), 'utf8') + '\nSome-Fork\n')
    expect(await refresh({ outDir: out, configDir: withFork, baseUrl: stub.url })).toBe(5)
    const list = JSON.parse(readFileSync(join(out, 'projects.json'), 'utf8')) as { name: string; featured: boolean }[]
    expect(list.find((p) => p.name === 'some-fork')).toMatchObject({ featured: true })
    const plain = join(tmp, 'plain-out')
    await refresh({ outDir: plain, configDir: cfg, baseUrl: stub.url })
    expect(readFileSync(join(plain, 'projects.json'), 'utf8')).not.toContain('some-fork')
  })
  it('rejects 0 projects before touching the out dir', async () => {
    await setup('empty')
    const nested = join(out, 'never')
    await expect(refresh({ outDir: nested, configDir: cfg, baseUrl: stub.url })).rejects.toThrow('No projects')
    expect(existsSync(nested)).toBe(false)
  })
  it('rejects override files with unknown fields, bad names or non-json', async () => {
    await setup('ok')
    const bad = join(tmp, 'badcfg')
    cpSync(cfg, bad, { recursive: true })
    const o = (f: string) => join(bad, 'overrides', f)
    const attempt = () => refresh({ outDir: out, configDir: bad, baseUrl: stub.url })
    writeFileSync(o('x.json'), '{"topics":[]}')
    await expect(attempt()).rejects.toThrow('x.json')
    writeFileSync(o('x.json'), 'not json')
    await expect(attempt()).rejects.toThrow('x.json')
    rmSync(o('x.json'))
    writeFileSync(o('bad name.json'), '{}')
    await expect(attempt()).rejects.toThrow('Bad override file name')
    rmSync(o('bad name.json'))
    writeFileSync(o('notes.txt'), 'x')
    await expect(attempt()).rejects.toThrow('Bad override file name')
    mkdirSync(out, { recursive: true })
  })
})
