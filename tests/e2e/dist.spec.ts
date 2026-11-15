import { test, expect } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Meta CSP blocks inline code, so the build must emit none.
test('dist has no inline script, style element or style attribute', () => {
  const files = (readdirSync('dist', { recursive: true }) as string[])
    .filter((f) => /\.html?$/.test(f))
    .map((f) => join('dist', f))
  expect(files.length).toBeGreaterThan(0)
  for (const f of files) {
    const html = readFileSync(f, 'utf8')
    expect(html, `${f}: inline script`).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/i)
    expect(html, `${f}: <style>`).not.toMatch(/<style[\s>]/i)
    expect(html, `${f}: style=`).not.toMatch(/\sstyle\s*=/i)
  }
})
