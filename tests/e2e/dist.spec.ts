import { test, expect } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const rules: [string, RegExp][] = [
  ['inline script', /<script(?![^>]*\ssrc=)[^>]*>/i],
  ['<style>', /<style[\s>]/i],
  ['style=', /\sstyle\s*=/i],
  ['inline handler', /\son[a-z]+\s*=/i],
  ['javascript:', /javascript:/i],
]

const violations = (html: string) => rules.filter(([, re]) => re.test(html)).map(([name]) => name)

test('violations() flags an inline event handler', () => {
  expect(violations('<a onclick="x()">')).toContain('inline handler')
  expect(violations('<a href="javascript:x()">')).toContain('javascript:')
  expect(violations('<a href="/ok">fine</a>')).toEqual([])
})

// Meta CSP blocks inline code, so the build must emit none.
test('dist has no inline script, style, handler or javascript: URL', () => {
  const files = readdirSync('dist', { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.html?$/.test(f))
    .map((f) => join('dist', f))
  expect(files.length).toBeGreaterThan(0)
  for (const f of files) expect(violations(readFileSync(f, 'utf8')), f).toEqual([])
})
