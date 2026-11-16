import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('@playwright/test', () => ({ chromium: { launch: vi.fn().mockRejectedValue(new Error('no chromium')) } }))
const { runShots } = await import('../../scripts/screenshots.ts')

const project = (name: string, homepage: string | null) => ({
  name, title: name, description: '', topics: [], language: null, languages: {}, homepage,
  repoUrl: `https://github.com/x/${name}`, pushedAt: '2026-01-01T00:00:00Z', stars: 0,
  screenshot: `${name}.webp`, featured: false, readmeHtml: '',
})

const tmp = mkdtempSync(join(tmpdir(), 'shots-launch-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('runShots when Chromium cannot launch', () => {
  it('keeps previous images, reports every failure, never touches projects.json', async () => {
    const gen = join(tmp, 'gen')
    const prev = join(tmp, 'prev')
    mkdirSync(gen)
    mkdirSync(prev)
    const json = JSON.stringify([project('has-prev', 'https://a.test/'), project('no-prev', 'https://b.test/')])
    writeFileSync(join(gen, 'projects.json'), json)
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])
    writeFileSync(join(prev, 'has-prev.webp'), webp)
    const failures = await runShots(gen, prev, { shot: { width: 10, height: 10, timeoutMs: 1000 } })
    expect(failures.filter((f) => f.startsWith('has-prev'))).toHaveLength(1)
    expect(failures.filter((f) => f.startsWith('no-prev'))).toHaveLength(2) // capture + card
    expect(readFileSync(join(gen, 'shots', 'has-prev.webp'))).toEqual(webp)
    expect(existsSync(join(gen, 'shots', 'no-prev.webp'))).toBe(false)
    expect(readFileSync(join(gen, 'projects.json'), 'utf8')).toBe(json)
  })
})
