import { describe, expect, it } from 'vitest'
import { decide, issueBody, oldestIssue, parseFailures } from '../../scripts/lib/issue.ts'

const f = [{ url: 'https://x.test/a', status: 500 }]
const open = [{ number: 7, createdAt: '2026-01-02T00:00:00Z' }]

describe('decide', () => {
  it('none open + failures -> create', () => expect(decide([], f)).toBe('create'))
  it('open + failures -> update', () => expect(decide(open, f)).toBe('update'))
  it('open + none -> close', () => expect(decide(open, [])).toBe('close'))
  it('none + none -> none', () => expect(decide([], [])).toBe('none'))
})

describe('oldestIssue', () => {
  it('picks the earliest createdAt', () => {
    const list = [{ number: 9, createdAt: '2026-03-01T00:00:00Z' }, { number: 3, createdAt: '2026-01-01T00:00:00Z' }, { number: 5, createdAt: '2026-02-01T00:00:00Z' }]
    expect(oldestIssue(list).number).toBe(3)
  })
  it('throws on empty list', () => expect(() => oldestIssue([])).toThrow())
})

describe('issueBody', () => {
  const now = new Date('2026-11-16T01:02:03.456Z')
  it('has a heading, the UTC ISO run date and one code-span line per failure', () => {
    const body = issueBody([{ url: 'https://x.test/a', status: 500 }, { url: 'https://y.test/', error: 'timeout' }], now)
    expect(body).toMatch(/^# /)
    expect(body).toContain('2026-11-16T01:02:03.456Z')
    expect(body).toContain('- `https://x.test/a` - HTTP 500')
    expect(body).toContain('- `https://y.test/` - `timeout`')
  })
  it('strips backticks, CR/LF and @ from url and error text', () => {
    const body = issueBody([{ url: 'https://x.test/`@user\r\n- injected', error: 'bad`\n@team ping' }], now)
    const lines = body.split('\n').filter((l) => l.startsWith('- '))
    expect(lines).toHaveLength(1)
    expect(body).not.toContain('@')
    expect(lines[0]).toBe('- `https://x.test/user- injected` - `badteam ping`')
  })
  it('truncates url to 300 and error to 200 chars with an ellipsis; shorter text is untouched', () => {
    const url = 'https://x.test/' + 'a'.repeat(400)
    const body = issueBody([{ url, error: 'e'.repeat(500) }, { url: 'u'.repeat(300), error: 'e'.repeat(200) }], now)
    const [long, exact] = body.split('\n').filter((l) => l.startsWith('- '))
    expect(long).toBe(`- \`${url.slice(0, 300)}…\` - \`${'e'.repeat(200)}…\``)
    expect(exact).toBe(`- \`${'u'.repeat(300)}\` - \`${'e'.repeat(200)}\``)
  })
  it('caps at 200 failure lines and says how many more', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ url: `https://x.test/${i}`, status: 404 }))
    const body = issueBody(many, now)
    expect(body.split('\n').filter((l) => l.startsWith('- `'))).toHaveLength(200)
    expect(body).toContain('and 50 more')
  })
  it('exactly 200 has no "more" line', () => {
    const body = issueBody(Array.from({ length: 200 }, (_, i) => ({ url: `https://x.test/${i}`, status: 404 })), now)
    expect(body).not.toContain('more')
  })
})

describe('parseFailures', () => {
  it('accepts a valid list', () => expect(parseFailures([{ url: 'https://a.test/', status: 404 }, { url: 'https://b.test/', error: 'timeout' }])).toHaveLength(2))
  it.each([null, {}, 'x', [1], [{}], [{ url: 5, status: 1 }], [{ url: 'https://a.test/' }], [{ url: 'https://a.test/', status: '404' }], [{ url: 'https://a.test/', error: 3 }]])('rejects %j', (v) => {
    expect(() => parseFailures(v)).toThrow()
  })
})
