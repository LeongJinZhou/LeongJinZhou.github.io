// Node built-ins and sibling lib files only: the health workflow runs without npm ci.
import type { Failure } from './links.ts'

export interface OpenIssue {
  number: number
  createdAt: string
}
export type Action = 'create' | 'update' | 'close' | 'none'

const MAX_LINES = 200

/** Rule 16: at most one open issue; failures create or update it, a clean run closes it. */
export function decide(open: OpenIssue[], failures: Failure[]): Action {
  if (failures.length > 0) return open.length > 0 ? 'update' : 'create'
  return open.length > 0 ? 'close' : 'none'
}

export function oldestIssue(open: OpenIssue[]): OpenIssue {
  const first = open.reduce<OpenIssue | undefined>((a, b) => (a === undefined || Date.parse(b.createdAt) < Date.parse(a.createdAt) ? b : a), undefined)
  if (!first) throw new Error('no open issue')
  return first
}

/** Untrusted text inside a code span: no backticks, line breaks or mentions. */
const clean = (s: string, max: number) => {
  const t = s.replace(/[`\r\n@]/g, '')
  return t.length > max ? t.slice(0, max) + '…' : t
}

export function issueBody(failures: Failure[], now: Date): string {
  const lines = failures.slice(0, MAX_LINES).map((f) => `- \`${clean(f.url, 300)}\` - ${f.status !== undefined ? `HTTP ${f.status}` : `\`${clean(f.error ?? 'error', 200)}\``}`)
  const more = failures.length - MAX_LINES
  return [
    '# Broken links',
    '',
    `Run date: ${now.toISOString()}`,
    '',
    `${failures.length} link(s) failed the weekly health check:`,
    '',
    ...lines,
    ...(more > 0 ? ['', `...and ${more} more`] : []),
    '',
  ].join('\n')
}

/** Hand-written shape check for the failures file (no schema library here). */
export function parseFailures(v: unknown): Failure[] {
  if (!Array.isArray(v)) throw new Error('failures file is not an array')
  return v.map((x: unknown) => {
    const f = x as Record<string, unknown> | null
    if (typeof f !== 'object' || f === null || typeof f.url !== 'string') throw new Error('bad failure entry')
    if (typeof f.status === 'number' && Number.isInteger(f.status)) return { url: f.url, status: f.status }
    if (typeof f.error === 'string' && f.status === undefined) return { url: f.url, error: f.error }
    throw new Error('bad failure entry')
  })
}
