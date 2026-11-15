import { afterEach, describe, expect, it } from 'vitest'
import { fetchLanguages, fetchRepos } from '../../scripts/lib/github.ts'
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
