import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://leongjinzhou.github.io',
  build: { inlineStylesheets: 'never' },
  // Meta CSP blocks inline code: never inline the filter script.
  vite: { build: { assetsInlineLimit: 0 } },
})
