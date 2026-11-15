import { afterEach, describe, expect, it } from 'vitest'
import { fetchLanguages, fetchReadme, fetchRepos } from '../../scripts/lib/github.ts'
import { startStub, type Stub } from '../helpers/stub.ts'

let stub: Stub
afterEach(() => stub.close())

describe('fetchRepos', () => {
  it('follows the Link header across pages', async () => {
    stub = await startStub()
    const repos = await fetchRepos({ baseUrl: stub.url })
    expect(repos).toHaveLength(10)
    expect(repos.map((r) => r.name)).toContain('Pocket-G')
  })
  it('sends the token as a Bearer header', async () => {
    stub = await startStub()
    await fetchRepos({ baseUrl: stub.url, token: 'tok123' })
    expect(stub.seenAuth.every((a) => a === 'Bearer tok123')).toBe(true)
  })
  it('sends no Authorization header without a token', async () => {
    stub = await startStub()
    await fetchRepos({ baseUrl: stub.url })
    expect(stub.seenAuth.every((a) => a === undefined)).toBe(true)
  })
  it('throws on HTTP 500 without leaking the token', async () => {
    stub = await startStub('error500')
    const err = await fetchRepos({ baseUrl: stub.url, token: 'secret-tok' }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe('GitHub API error: HTTP 500')
    expect((err as Error).message).not.toContain('secret-tok')
  })
  it('refuses a next page on a different origin and never contacts it', async () => {
    stub = await startStub('foreign-next')
    await expect(fetchRepos({ baseUrl: stub.url, token: 'secret-tok' })).rejects.toThrow('different origin')
  })
  it('rejects a response that fails the schema', async () => {
    stub = await startStub()
    const orig = globalThis.fetch
    globalThis.fetch = () => Promise.resolve(new Response('[{"name":1}]'))
    try {
      await expect(fetchRepos({ baseUrl: stub.url })).rejects.toThrow()
    } finally {
      globalThis.fetch = orig
    }
  })
  it('stops after too many pages', async () => {
    stub = await startStub()
    const orig = globalThis.fetch
    globalThis.fetch = () =>
      Promise.resolve(new Response('[]', { headers: { link: `<${stub.url}/users/LeongJinZhou/repos?page=2>; rel="next"` } }))
    try {
      await expect(fetchRepos({ baseUrl: stub.url })).rejects.toThrow('too many pages')
    } finally {
      globalThis.fetch = orig
    }
  })
})

describe('token transport', () => {
  it('refuses a token over plain http to a non-local host (no request made)', async () => {
    stub = await startStub()
    await expect(fetchRepos({ baseUrl: 'http://api.example.com', token: 't' })).rejects.toThrow('https')
    await expect(fetchLanguages('x', { baseUrl: 'http://api.example.com', token: 't' })).rejects.toThrow('https')
  })
  it.each(['http://localhost:1', 'http://127.0.0.1:1'])('allows a token to %s (fails on connect, not on the guard)', async (u) => {
    stub = await startStub()
    const err = await fetchRepos({ baseUrl: u, token: 't' }).catch((e: Error) => e)
    expect((err as Error).message).not.toContain('https')
  })
})

describe('fetchLanguages', () => {
  it('returns the byte map', async () => {
    stub = await startStub()
    expect(await fetchLanguages('OCR1', { baseUrl: stub.url })).toEqual({ Dart: 4000 })
  })
  it('throws on error status', async () => {
    stub = await startStub('languages500')
    await expect(fetchLanguages('OCR1', { baseUrl: stub.url })).rejects.toThrow('HTTP 500')
  })
})

describe('fetchReadme', () => {
  const o = () => ({ baseUrl: stub.url })
  const none = { text: '', dir: '' }
  it('returns the decoded README text and dir', async () => {
    stub = await startStub()
    const r = await fetchReadme('qiu-cpdc-career-portal', o())
    expect(r.text).toContain('# Career Portal')
    expect(r.dir).toBe('')
  })
  it('404 -> empty (missing README)', async () => {
    stub = await startStub()
    expect(await fetchReadme('OCR1', o())).toEqual(none)
  })
  it('other errors throw without leaking the token', async () => {
    stub = await startStub('readme500')
    const err = await fetchReadme('Pocket-G', { ...o(), token: 'secret-tok' }).catch((e: Error) => e)
    expect((err as Error).message).toBe('GitHub API error: HTTP 500')
  })
  it('rejects a response that fails the schema', async () => {
    stub = await startStub()
    const orig = globalThis.fetch
    globalThis.fetch = () => Promise.resolve(new Response('{"content":1}'))
    try {
      await expect(fetchReadme('x', o())).rejects.toThrow()
    } finally {
      globalThis.fetch = orig
    }
  })
  it('sends Bearer with a token and no Authorization header without', async () => {
    stub = await startStub()
    await fetchReadme('Pocket-G', { ...o(), token: 'tok9' })
    expect(stub.seenAuth).toEqual(['Bearer tok9'])
    stub.seenAuth.length = 0
    await fetchReadme('Pocket-G', o())
    expect(stub.seenAuth).toEqual([undefined])
  })
  it('refuses to send a token over non-https to a remote host', async () => {
    stub = await startStub()
    await expect(fetchReadme('x', { baseUrl: 'http://example.com', token: 't' })).rejects.toThrow('non-https')
  })
  it('returns the directory of a nested README path', async () => {
    stub = await startStub()
    expect((await fetchReadme('nested', o())).dir).toBe('docs')
  })
  it('decodes multi-byte UTF-8 (CJK, emoji)', async () => {
    stub = await startStub()
    expect((await fetchReadme('unicode', o())).text).toBe('# 你好 😀\n')
  })
  it('encoding other than base64 (README > 1 MB) -> empty, no abort', async () => {
    stub = await startStub()
    expect(await fetchReadme('toobig', o())).toEqual(none)
  })
  it('404 is detected by status, not message text', async () => {
    stub = await startStub()
    const orig = globalThis.fetch
    globalThis.fetch = () => Promise.resolve(new Response('{}', { status: 404, statusText: 'Whatever' }))
    try {
      expect(await fetchReadme('x', o())).toEqual(none)
    } finally {
      globalThis.fetch = orig
    }
  })
})
