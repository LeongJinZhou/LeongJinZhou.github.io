import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')

function walk(dir: string, rel: string): string[] {
  if (!existsSync(join(dir, rel))) return []
  return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(dir, `${rel}/${e.name}`) : [`${rel}/${e.name}`]))
}

/** Same shape as the generate job's step: sha256sum lines for projects.json and every file under profile/. Returns the hash of the manifest file. */
export function writeManifest(dir: string): string {
  const files = [...(existsSync(join(dir, 'projects.json')) ? ['projects.json'] : []), ...walk(dir, 'profile')].sort()
  const text = files.map((f) => `${sha(readFileSync(join(dir, f)))}  ${f}\n`).join('')
  writeFileSync(join(dir, 'MANIFEST.sha256'), text)
  return sha(text)
}
