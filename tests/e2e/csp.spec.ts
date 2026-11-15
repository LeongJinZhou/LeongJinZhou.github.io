import { test, expect } from '@playwright/test'

// Proves the CSP is really enforced, so "zero CSP errors" in smoke is not vacuous.
test('meta CSP and referrer present; inline script is blocked', async ({ page }) => {
  await page.goto('/')
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(csp).toContain("script-src 'self'")
  expect(csp).toContain("object-src 'none'")
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'strict-origin-when-cross-origin')
  const ran = await page.evaluate(() => {
    const s = document.createElement('script')
    s.textContent = 'window.__inlineRan = true'
    document.head.appendChild(s)
    return (window as unknown as { __inlineRan?: boolean }).__inlineRan === true
  })
  expect(ran).toBe(false)
})
