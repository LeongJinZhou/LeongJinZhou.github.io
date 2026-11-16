// Runs the real refresh.yml verdict script with the env GitHub would give it (Q7, rule 9, S10).
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

type Step = { run?: string }
const wf = parse(readFileSync(fileURLToPath(new URL('../../.github/workflows/refresh.yml', import.meta.url)), 'utf8'))
const script = (wf.jobs.verdict.steps as Step[])[0]?.run ?? ''

// On Windows prefer Git Bash: a bare "bash" can resolve to WSL.
const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
const bash = process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'bash'
const hasBash = spawnSync(bash, ['-c', 'true']).status === 0

const verdict = (RESULTS: string, SHOTS_FAILED: string) =>
  spawnSync(bash, ['-c', script], { encoding: 'utf8', env: { ...process.env, RESULTS, SHOTS_FAILED } })

const ALL_OK = 'success success success success'

describe.skipIf(!hasBash)('refresh.yml verdict script', () => {
  it('passes when every job succeeded and no screenshot failed', () => {
    const r = verdict(ALL_OK, 'false')
    expect(r.status, r.stdout + r.stderr).toBe(0)
  })
  it('fails the run on failed=true even though commit and deploy succeeded', () => {
    const r = verdict(ALL_OK, 'true')
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('::error::A screenshot failed; old image or card was used.')
  })
  it.each(['failure', 'cancelled', 'skipped'])('fails the run when a job ended as %s', (bad) => {
    const r = verdict(`success success ${bad} success`, 'false')
    expect(r.status).toBe(1)
    expect(r.stdout).toContain(`::error::A refresh job ended as ${bad}.`)
  })
  it('fails when the screenshots job died before setting its output', () => {
    const r = verdict('success failure skipped skipped', '')
    expect(r.status).toBe(1)
  })
})
