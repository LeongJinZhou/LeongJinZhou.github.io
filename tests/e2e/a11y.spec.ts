import { test, expect } from './fixtures.ts'
import AxeBuilder from '@axe-core/playwright'

// Rules 18-19: axe 0 violations, dark and light, home + one detail. Both viewport projects (375, 1280) run it.
for (const scheme of ['dark', 'light'] as const) {
  for (const url of ['/', '/projects/qiu-cpdc-career-portal/']) {
    test(`axe: ${url} ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await page.goto(url)
      await page.waitForLoadState('load')
      const r = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze()
      expect(
        r.violations.map((v) => `${v.id}\n${v.nodes.map((n) => `${n.target.join(' ')}: ${n.failureSummary ?? ''}`).join('\n')}`),
      ).toEqual([])
    })
  }
}
