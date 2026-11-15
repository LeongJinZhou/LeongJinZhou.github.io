import { type Page } from '@playwright/test'
import { test, expect } from './fixtures.ts'
import { existsSync, readFileSync } from 'node:fs'

// Expected results come from the fixture data, not from the page, so a wrong data-tech or a wrong match both fail.
type P = { name: string; title: string; language: string | null; topics: string[] }
const hidden = new Set(readFileSync('tests/fixtures/hidden.txt', 'utf8').split('\n').map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#')))
const shown = (JSON.parse(readFileSync('tests/fixtures/generated/projects.json', 'utf8')) as P[]).filter((p) => !hidden.has(p.name.toLowerCase()))
const usesTech = (p: P, t: string) => [p.language, ...p.topics].some((x) => x?.toLowerCase() === t.toLowerCase())

const visibleNames = (page: Page) =>
  page.locator('#projects [data-testid="project-card"]:visible').evaluateAll((els) => els.map((e) => e.getAttribute('data-name')).sort())

test('S2: every technology filter shows exactly the projects using it, per the data', async ({ page }) => {
  await page.goto('/')
  const group = page.getByRole('group', { name: 'Filter by technology' })
  const chips = await group.locator('button[data-tech]:not([data-tech=""])').allTextContents()
  expect(chips.length).toBeGreaterThan(3)
  for (const t of chips) {
    await group.getByRole('button', { name: t, exact: true }).click()
    const want = shown.filter((p) => usesTech(p, t)).map((p) => p.name).sort()
    expect(want.length, t).toBeGreaterThan(0)
    await expect.poll(() => visibleNames(page), t).toEqual(want)
    await group.getByRole('button', { name: t, exact: true }).click() // toggle off
    await expect.poll(() => visibleNames(page).then((n) => n.length)).toBe(shown.length)
  }
})

test('S1 to S3: every card links to a built detail page with the same title', async ({ page }) => {
  await page.goto('/')
  const links = await page
    .locator('#projects [data-testid="project-card"] h3 a')
    .evaluateAll((els) => els.map((a) => ({ href: a.getAttribute('href') ?? '', title: a.textContent?.trim() ?? '' })))
  expect(links).toHaveLength(shown.length)
  for (const { href, title } of links) {
    expect(existsSync(`dist${href}index.html`), href).toBe(true)
    await page.goto(href)
    await expect(page.locator('h1')).toHaveText(title)
    await expect(page.getByRole('link', { name: /Repository/ })).toHaveAttribute('href', /^https:\/\/github\.com\/LeongJinZhou\//)
  }
})

test.describe('rule 18: motion respects prefers-reduced-motion', () => {
  const motion = (page: Page) =>
    page.evaluate(() => ({
      cursor: getComputedStyle(document.querySelector('.cursor')!).animationName,
      card: getComputedStyle(document.querySelector('.card')!).transitionDuration,
      scroll: getComputedStyle(document.documentElement).scrollBehavior,
    }))

  test('reduce: no animation, transition or smooth scroll', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    expect(await motion(page)).toEqual({ cursor: 'none', card: '0s', scroll: 'auto' })
  })

  test('no-preference: motion is on (proves the check above can fail)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/')
    const m = await motion(page)
    expect(m.cursor).toBe('blink')
    expect(m.card).not.toBe('0s')
    expect(m.scroll).toBe('smooth')
  })
})
