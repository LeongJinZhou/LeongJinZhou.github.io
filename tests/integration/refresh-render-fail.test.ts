import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { refresh } from '../../scripts/refresh.ts'
import { startStub } from '../helpers/stub.ts'

const tmp = mkdtempSync(join(tmpdir(), 'rf-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('README render failure is contained (DoS guard)', () => {
  // Real input, no mock: the API sends a default_branch with a lone surrogate, which makes renderReadme throw.
  it('failing repo gets "" and is logged by name only; others still render', async () => {
    const cfg = join(tmp, 'config')
    cpSync('config', cfg, { recursive: true })
    writeFileSync(join(cfg, 'hidden.txt'), 'hidden-one\n')
    const stub = await startStub('bad-branch')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await refresh({ outDir: join(tmp, 'o'), configDir: cfg, baseUrl: stub.url })
    } finally {
      await stub.close()
    }
    const list = JSON.parse(readFileSync(join(tmp, 'o', 'projects.json'), 'utf8')) as { name: string; readmeHtml: string }[]
    expect(list.find((p) => p.name === 'Pocket-G')?.readmeHtml).toBe('')
    expect(list.find((p) => p.name === 'qiu-cpdc-career-portal')?.readmeHtml).toContain('<h1>')
    expect(err.mock.calls).toEqual([['README render failed: Pocket-G']])
  })
})
