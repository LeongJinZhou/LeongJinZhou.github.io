import { test, expect } from './fixtures.ts'

test('home loads, h1 has name, no CSP console errors', async ({ page }) => {
  const problems: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' || /content security policy/i.test(m.text())) problems.push(m.text())
  })
  page.on('pageerror', (e) => problems.push(e.message))
  await page.goto('/')
  await expect(page).toHaveTitle('Leong Jin Zhou — AI Technologist at QIU')
  await expect(page.locator('h1')).toHaveText('Leong Jin Zhou')
  expect(problems).toEqual([])
})
