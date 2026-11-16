import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

const fx = (f: string) => readFileSync(new URL(`../fixtures/github/${f}`, import.meta.url), 'utf8')

export type Mode =
  | 'ok' | 'error500' | 'empty' | 'languages500' | 'foreign-next' | 'malformed' | 'new-repo' | 'readme500' | 'bad-branch'
  | 'graphql-errors' | 'graphql-null-user' | 'graphql-partial-errors'

export interface Stub {
  url: string
  seenAuth: (string | undefined)[]
  /** Bodies of every POST /graphql request. */
  graphql: string[]
  mode: Mode
  close: () => Promise<void>
}

export async function startStub(mode: Mode = 'ok'): Promise<Stub> {
  const seenAuth: (string | undefined)[] = []
  const stub = { seenAuth, mode, graphql: [] as string[] } as Stub
  const server: Server = createServer((req, res) => {
    seenAuth.push(req.headers.authorization)
    const u = new URL(req.url ?? '/', 'http://x')
    const send = (status: number, body: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(body)
    }
    if (stub.mode === 'error500') return send(500, '{"message":"boom"}')
    if (u.pathname === '/graphql' && req.method === 'POST') {
      let body = ''
      req.on('data', (c: Buffer) => (body += c))
      req.on('end', () => {
        stub.graphql.push(body)
        if (stub.mode === 'graphql-errors') return send(200, '{"errors":[{"message":"Something went wrong"}],"data":null}')
        if (stub.mode === 'graphql-null-user') return send(200, '{"data":{"user":null}}')
        // Valid data plus an errors entry: GraphQL partial success must still fail (rule 13).
        if (stub.mode === 'graphql-partial-errors') return send(200, fx('graphql.json').replace(/}\s*$/, ',"errors":[{"message":"partial"}]}'))
        send(200, fx('graphql.json'))
      })
      return
    }
    if (u.pathname === '/users/LeongJinZhou/repos') {
      if (stub.mode === 'empty') return send(200, '[]')
      if (stub.mode === 'malformed') return send(200, '[{"name":1}]')
      if (u.searchParams.get('page') === '2') {
        if (stub.mode === 'bad-branch') {
          // Lone surrogate: valid JSON, but encodeURIComponent throws URIError inside renderReadme.
          const page = JSON.parse(fx('repos-page2.json')) as Record<string, unknown>[]
          return send(200, JSON.stringify(page.map((r) => (r.name === 'Pocket-G' ? { ...r, default_branch: '\uD800' } : r))))
        }
        if (stub.mode !== 'new-repo') return send(200, fx('repos-page2.json'))
        const page = JSON.parse(fx('repos-page2.json')) as Record<string, unknown>[]
        const newRepo = { ...page.find((r) => r.name === 'Pocket-G'), name: 'brand-new', pushed_at: '2026-11-14T12:00:00Z' }
        return send(200, JSON.stringify([...page, newRepo]))
      }
      const next =
        stub.mode === 'foreign-next' ? 'http://evil.example.com/x?page=2' : `${stub.url}/users/LeongJinZhou/repos?page=2`
      return send(200, fx('repos-page1.json'), { link: `<${stub.url}/users/LeongJinZhou/repos?page=2>; rel="last", <${next}>; rel="next"` })
    }
    const m = u.pathname.match(/^\/repos\/LeongJinZhou\/([^/]+)\/languages$/)
    if (m?.[1]) {
      if (stub.mode === 'languages500') return send(500, '{}')
      const all = JSON.parse(fx('languages.json')) as Record<string, unknown>
      return send(200, JSON.stringify(all[m[1]] ?? {}))
    }
    const rm = u.pathname.match(/^\/repos\/LeongJinZhou\/([^/]+)\/readme$/)
    if (rm?.[1]) {
      if (stub.mode === 'readme500') return send(500, '{}')
      const md = (JSON.parse(fx('readmes.json')) as Record<string, string>)[rm[1]]
      if (md === undefined && rm[1] !== 'toobig') return send(404, '{"message":"Not Found"}')
      const path = rm[1] === 'nested' ? 'docs/README.md' : 'README.md'
      if (rm[1] === 'toobig') return send(200, JSON.stringify({ encoding: 'none', content: '', path }))
      return send(200, JSON.stringify({ encoding: 'base64', path, content: Buffer.from(md ?? '').toString('base64') }))
    }
    send(404, '{}')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  stub.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  stub.close = () => new Promise((r) => server.close(() => r()))
  return stub
}
