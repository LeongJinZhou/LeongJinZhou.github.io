import { test as base, expect } from '@playwright/test'

// Tests must not depend on shields.io being up or fast: serve a stub badge for every request to it.
const BADGE = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="20"><rect width="60" height="20" fill="#1f2937"/></svg>'

export const stubBadges = (ctx: { route: import('@playwright/test').BrowserContext['route'] }) =>
  ctx.route('https://img.shields.io/**', (r) => r.fulfill({ contentType: 'image/svg+xml', body: BADGE }))

export const test = base.extend({
  context: async ({ context }, use) => {
    await stubBadges(context)
    await use(context)
  },
})
export { expect }
