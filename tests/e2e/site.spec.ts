import { type Page } from '@playwright/test'
import { test, expect, stubBadges } from './fixtures.ts'
import { existsSync, readFileSync } from 'node:fs'

const FEATURED = readFileSync('config/featured.txt', 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))

const names = (page: Page, scope: string) =>
  page.locator(`${scope} [data-testid="project-card"]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-name')))

test.describe('S1 home sections', () => {
  test('hero shows name, title, pitch; all 5 other sections present', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h1')).toHaveText('Leong Jin Zhou')
    await expect(page.locator('.hero')).toContainText('AI Technologist at QIU')
    for (const [id, name] of [
      ['about', 'About'],
      ['featured', 'Featured projects'],
      ['projects', 'All projects'],
      ['skills', 'Skills'],
      ['contact', 'Contact'],
    ] as const) {
      await expect(page.locator(`section#${id} h2`)).toHaveText(name)
    }
  })

  test('featured follow featured.txt order (rule 4); hidden repo absent; newest push first (rules 1, 5)', async ({ page }) => {
    await page.goto('/')
    expect(await names(page, '#featured')).toEqual(FEATURED)
    const all = await names(page, '#projects')
    expect(all).not.toContain('hidden-demo')
    expect(all[0]).toBe('qiu-ai-video-2026')
    expect(all).toHaveLength(9)
  })

  test('card with screenshot renders an image; without, a generated card', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#featured [data-name="qiu-cpdc-career-portal"] img.shot')).toHaveAttribute('src', /\/shots\/qiu-cpdc-career-portal\.webp$/)
    await expect(page.locator('#featured [data-name="OCR1"] .shot-card')).toBeVisible()
  })

  test('skills are https badge images', async ({ page }) => {
    await page.goto('/')
    const srcs = await page.locator('#skills img').evaluateAll((els) => els.map((e) => e.getAttribute('src')))
    expect(srcs.length).toBeGreaterThan(5)
    for (const s of srcs) expect(s).toMatch(/^https:\/\/img\.shields\.io\/badge\//)
  })

  test('shows a last-refreshed line', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('footer')).toContainText(/Last refreshed \d{4}-\d{2}-\d{2}/)
  })
})

test.describe('S2 filter', () => {
  const group = (page: Page) => page.getByRole('group', { name: 'Filter by technology' })
  const tech = (page: Page, name: string) => group(page).getByRole('button', { name, exact: true })
  const visible = (page: Page) => page.locator('#projects [data-testid="project-card"]:visible')

  test('without JS all cards are visible and filter controls are hidden', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false })
    await stubBadges(ctx)
    const page = await ctx.newPage()
    await page.goto(baseURL ?? '/')
    await expect(visible(page)).toHaveCount(9)
    await expect(page.locator('[data-filter]')).toBeHidden()
    await ctx.close()
  })

  test('picking a technology keeps only matching cards; All resets', async ({ page }) => {
    await page.goto('/')
    await tech(page, 'Swift').click()
    await expect(tech(page, 'Swift')).toHaveAttribute('aria-pressed', 'true')
    await expect(visible(page)).toHaveCount(1)
    await expect(visible(page).first()).toHaveAttribute('data-name', 'SmartRecipe-ContextAware-iOS')
    await group(page).getByRole('button', { name: 'All', exact: true }).click()
    await expect(visible(page)).toHaveCount(9)
  })

  test('topic filter works; a combination with no match shows message + reset', async ({ page }) => {
    await page.goto('/')
    await tech(page, 'prisma').click()
    await expect(visible(page)).toHaveCount(2)
    await tech(page, 'Swift').click()
    await expect(visible(page)).toHaveCount(0)
    await expect(page.getByTestId('filter-empty')).toBeVisible()
    await page.getByTestId('filter-empty').getByRole('button', { name: 'Reset filters' }).click()
    await expect(page.getByTestId('filter-empty')).toBeHidden()
    await expect(visible(page)).toHaveCount(9)
  })

  test('after Reset filters, focus moves to the All chip', async ({ page }) => {
    await page.goto('/')
    await tech(page, 'prisma').click()
    await tech(page, 'Swift').click()
    await page.getByTestId('filter-empty').getByRole('button', { name: 'Reset filters' }).click()
    await expect(group(page).getByRole('button', { name: 'All', exact: true })).toBeFocused()
  })

  test('filter buttons work by keyboard', async ({ page }) => {
    await page.goto('/')
    await tech(page, 'Dart').focus()
    await page.keyboard.press('Enter')
    await expect(visible(page)).toHaveCount(1)
  })
})

test.describe('S3 detail page', () => {
  test('opens from a card: title, summary, stack, screenshot, repo + live links, README', async ({ page }) => {
    await page.goto('/')
    await page.locator('#projects [data-name="qiu-cpdc-career-portal"] a').first().click()
    await expect(page).toHaveURL(/\/projects\/qiu-cpdc-career-portal\/?$/)
    await expect(page.locator('h1')).toHaveText('QIU CPDC Career Portal')
    await expect(page.getByText('Multi-role career and industrial placement platform')).toBeVisible()
    await expect(page.getByTestId('stack')).toContainText('TypeScript')
    await expect(page.getByTestId('stack')).toContainText('nextjs')
    const shot = page.locator('img.shot')
    await expect(shot).toBeVisible()
    await shot.scrollIntoViewIfNeeded()
    await expect.poll(() => shot.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true)
    await expect(page.getByRole('link', { name: /Repository/ })).toHaveAttribute('href', 'https://github.com/LeongJinZhou/qiu-cpdc-career-portal')
    await expect(page.getByRole('link', { name: /Live/ })).toHaveAttribute('href', /^https:\/\//)
    await expect(page.locator('.readme h4')).toHaveText('Setup')
  })

  test('no live link without homepage; generated card without screenshot', async ({ page }) => {
    await page.goto('/projects/university-ims-erp/')
    await expect(page.getByRole('link', { name: /Repository/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Live/ })).toHaveCount(0)
    await expect(page.locator('.shot-card')).toBeVisible()
  })

  test('hidden project has no page; shown project has one', () => {
    expect(existsSync('dist/projects/hidden-demo/index.html')).toBe(false)
    expect(existsSync('dist/projects/qiu-ai-video-2026/index.html')).toBe(true)
  })
})

test('rule 17: no LinkedIn when unset, no email or phone anywhere', async ({ page }) => {
  for (const url of ['/', '/projects/qiu-cpdc-career-portal/']) {
    await page.goto(url)
    await expect(page.locator('a[href*="linkedin" i]')).toHaveCount(0)
    await expect(page.locator('a[href^="mailto:"], a[href^="tel:"]')).toHaveCount(0)
    expect(await page.content()).not.toMatch(/mailto:|tel:|[\w.+-]+@[\w-]+\.[a-z]{2,}/i)
  }
  await page.goto('/')
  await expect(page.locator('#contact').getByRole('link', { name: /GitHub/ })).toHaveAttribute('href', 'https://github.com/LeongJinZhou')
})

test('rules 18-19: no horizontal scroll', async ({ page }) => {
  for (const url of ['/', '/projects/qiu-cpdc-career-portal/']) {
    await page.goto(url)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }
})

test('WCAG 2.4.11: after each nav anchor the section heading is not under the sticky header', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const header = page.locator('.site-header')
  const links = await page.locator('.site-header nav a').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''))
  expect(links).toHaveLength(5)
  for (const href of links) {
    await page.locator(`.site-header nav a[href="${href}"]`).click()
    const id = href.split('#')[1]
    await expect
      .poll(async () => {
        const h = (await header.boundingBox())!
        const t = (await page.locator(`#${id} h2`).boundingBox())!
        return t.y >= h.y + h.height - 1
      }, href)
      .toBe(true)
  }
})

test('mobile header stays one row of nav (<= 3.5rem tall bar)', async ({ page }) => {
  await page.goto('/')
  expect((await page.locator('.site-header').boundingBox())!.height).toBeLessThanOrEqual(64)
})

test('README table, blockquote, inline code and code block render styled without page scroll', async ({ page }) => {
  await page.goto('/projects/qiu-cpdc-career-portal/')
  const css = (sel: string, prop: string) => page.locator(sel).first().evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop)
  expect(await css('.readme td', 'border-top-width')).toBe('1px')
  expect(parseFloat(await css('.readme td', 'padding-left'))).toBeGreaterThan(4)
  expect(parseFloat(await css('.readme blockquote', 'border-left-width'))).toBeGreaterThan(1)
  expect(await css('.readme p code', 'background-color')).not.toBe('rgba(0, 0, 0, 0)')
  await expect(page.locator('.readme pre')).toContainText('npm run build')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('detail page without screenshot: placeholder is small', async ({ page }) => {
  await page.goto('/projects/university-ims-erp/')
  expect((await page.locator('.shot-card').boundingBox())!.height).toBeLessThan(160)
})
