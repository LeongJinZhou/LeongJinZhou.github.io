import tseslint from 'typescript-eslint'
import astro from 'eslint-plugin-astro'

export default [
  { ignores: ['dist/', '.astro/', 'coverage/', 'playwright-report/', 'test-results/', 'generated/', 'public/shots/', 'profile/'] },
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
]
