// Node built-ins and sibling lib files only: the health workflow runs without npm ci.
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { decide, issueBody, oldestIssue, parseFailures, type OpenIssue } from './lib/issue.ts'

/** Runs `gh <args>`, optionally feeding stdin, resolves with stdout. */
export type Gh = (args: string[], input?: string) => Promise<string>

const LABEL = 'health-check'

const gh: Gh = (args, input) =>
  new Promise((resolve, reject) => {
    const child = execFile('gh', args, { maxBuffer: 10 * 1024 * 1024, timeout: 60_000 }, (e, stdout) => (e ? reject(e) : resolve(stdout)))
    child.stdin?.end(input)
  })

function parseOpen(text: string): OpenIssue[] {
  const v: unknown = JSON.parse(text)
  if (!Array.isArray(v)) throw new Error('gh issue list: not an array')
  return v.map((x: unknown) => {
    const i = x as Record<string, unknown> | null
    if (typeof i !== 'object' || i === null || !Number.isInteger(i.number) || (i.number as number) <= 0 || typeof i.createdAt !== 'string') throw new Error('gh issue list: bad entry')
    return { number: i.number as number, createdAt: i.createdAt }
  })
}

/** Rule 16: one open `health-check` issue; update it while links fail, close it when they are healthy. */
export async function report(file: string, run: Gh, now: Date): Promise<void> {
  const failures = parseFailures(JSON.parse(readFileSync(file, 'utf8')))
  await run(['label', 'create', LABEL, '--force'])
  const open = parseOpen(await run(['issue', 'list', '--label', LABEL, '--state', 'open', '--json', 'number,createdAt']))
  switch (decide(open, failures)) {
    case 'create':
      await run(['issue', 'create', '--title', 'Health check: broken links', '--label', LABEL, '--body-file', '-'], issueBody(failures, now))
      break
    case 'update':
      await run(['issue', 'edit', String(oldestIssue(open).number), '--body-file', '-'], issueBody(failures, now))
      break
    case 'close':
      for (const i of [...open].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))) {
        await run(['issue', 'close', String(i.number), '--comment', `All links healthy on ${now.toISOString().slice(0, 10)}.`])
      }
      break
    case 'none':
      break
  }
}

if (import.meta.main) {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: node scripts/health-report.ts <failures.json>')
    process.exit(2)
  }
  // gh reads the repo from GH_REPO.
  if (!process.env.GH_REPO && process.env.GITHUB_REPOSITORY) process.env.GH_REPO = process.env.GITHUB_REPOSITORY
  try {
    await report(file, gh, new Date())
  } catch (e) {
    console.error(`health-report failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    process.exit(1)
  }
}
