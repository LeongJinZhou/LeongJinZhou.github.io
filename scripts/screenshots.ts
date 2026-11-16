import { appendFileSync, copyFileSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, closeSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium, type Browser } from '@playwright/test'
import { z } from 'zod'
import { ProjectSchema, SettingsSchema } from './lib/schemas.ts'
import { captureUrl, chooseShot, renderCard, shotName, type Shot } from './lib/shots.ts'

export interface ShotOpts {
  shot?: Shot
  allowHost?: string
  /** Test seam: replaces the live capture. */
  capture?: (browser: Browser, url: string, s: Shot) => Promise<Buffer>
}

/** A previous image is trusted only if it is a plain file with a WebP header. */
function previousShot(file: string): boolean {
  try {
    if (!lstatSync(file).isFile()) return false
    const fd = openSync(file, 'r')
    try {
      const h = Buffer.alloc(12)
      readSync(fd, h, 0, 12, 0)
      return h.toString('latin1', 0, 4) === 'RIFF' && h.toString('latin1', 8, 12) === 'WEBP'
    } finally {
      closeSync(fd)
    }
  } catch {
    return false
  }
}

/** Writes generatedDir/shots/*.webp only (projects.json is read, never written: it comes from the trusted generate job). Returns the failure messages. */
export async function runShots(generatedDir: string, previousDir: string, o: ShotOpts = {}): Promise<string[]> {
  const shot = o.shot ?? SettingsSchema.parse(JSON.parse(readFileSync(join(import.meta.dirname, '..', 'config', 'settings.json'), 'utf8'))).shot
  const file = join(generatedDir, 'projects.json')
  const projects = z.array(ProjectSchema).parse(JSON.parse(readFileSync(file, 'utf8')))
  const shots = join(generatedDir, 'shots')
  mkdirSync(shots, { recursive: true })
  const failures: string[] = []
  let browser: Browser | undefined
  let launchError: unknown
  try {
    browser = await chromium.launch({ chromiumSandbox: true, args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] })
  } catch (e) {
    launchError = e
  }
  const need = (): Browser => {
    if (!browser) throw new Error('browser unavailable', { cause: launchError })
    return browser
  }
  try {
    for (const p of projects) {
      const name = `${shotName(p.name)}.webp`
      if (p.screenshot !== name) continue // override: left untouched
      const prev = join(previousDir, name)
      let img: Buffer | undefined
      let ok = true
      try {
        img = p.homepage ? await (o.capture ?? ((b, u, s) => captureUrl(b, u, s, { allowHost: o.allowHost })))(need(), p.homepage, shot) : await renderCard(need(), p, shot)
      } catch (e) {
        ok = false
        failures.push(`${p.name}: ${e instanceof Error ? e.message.split('\n')[0] : 'failed'}`)
      }
      const choice = chooseShot(ok, previousShot(prev))
      try {
        if (choice === 'new') writeFileSync(join(shots, name), img as Buffer)
        else if (choice === 'previous') copyFileSync(prev, join(shots, name))
        else writeFileSync(join(shots, name), await renderCard(need(), p, shot))
      } catch (e) {
        failures.push(`${p.name}: card failed: ${e instanceof Error ? e.message.split('\n')[0] : 'failed'}`)
      }
    }
  } finally {
    await browser?.close()
  }
  return failures
}

if (import.meta.main) {
  const [gen, prev] = process.argv.slice(2)
  if (!gen || !prev) {
    console.error('Usage: node scripts/screenshots.ts <generatedDir> <previousShotsDir>')
    process.exit(2)
  }
  let failures: string[]
  try {
    failures = await runShots(resolve(gen), resolve(prev))
  } catch (e) {
    console.error(`screenshots: bad input: ${e instanceof Error ? e.message : 'unknown error'}`)
    process.exit(2)
  }
  for (const f of failures) console.error(`screenshot failure: ${f}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `failed=${failures.length > 0}\n`)
  console.log(`screenshots: ${failures.length} failure(s)`)
}
