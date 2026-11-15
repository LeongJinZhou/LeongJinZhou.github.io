import { describe, expect, it } from 'vitest'
import { readmeSchema, renderReadme } from '../../scripts/lib/readme.ts'

const ctx = { owner: 'LeongJinZhou', repo: 'demo', branch: 'main', dir: '' }
const render = (md: string, c = ctx) => renderReadme(md, c)
const RAW = 'https://raw.githubusercontent.com/LeongJinZhou/demo/main'
const BLOB = 'https://github.com/LeongJinZhou/demo/blob/main'

describe('renderReadme: sanitising (rule 7, S3)', () => {
  it('renders ordinary markdown', () => {
    expect(render('# Hi\n\n**bold** text')).toBe('<h1>Hi</h1>\n<p><strong>bold</strong> text</p>')
  })
  it('missing README -> empty string', () => {
    expect(render('')).toBe('')
  })
  it('removes <script> and its content is not executable', () => {
    const h = render('hello\n\n<script>alert(1)</script>\n')
    expect(h).not.toContain('<script')
    expect(h).toContain('<p>hello</p>')
  })
  it('drops raw HTML entirely (even benign tags)', () => {
    const h = render('<div onclick="x()"><b>hi</b></div>\n\n<img src=x onerror=alert(1)>')
    expect(h).not.toMatch(/<div|<b>|onerror|onclick|<img/i)
  })
  it('no on* attribute can survive', () => {
    expect(render('![a](https://x.test/a.png "t")\n\n[l](https://x.test)')).not.toMatch(/\son\w+=/i)
  })
  it('removes javascript: links but keeps the text', () => {
    const h = render('[click](javascript:alert(1))')
    expect(h).not.toContain('javascript:')
    expect(h).toContain('click')
  })
  it('removes data: and other schemes on links and images', () => {
    const h = render('[a](data:text/html,<b>) [b](vbscript:x) [c](file:///etc/passwd) [m](mailto:a@b.c)\n\n![i](data:image/png;base64,AAAA)')
    expect(h).not.toMatch(/data:|vbscript:|file:|mailto:|<img/i)
  })
  it('obfuscated javascript: scheme is removed', () => {
    expect(render('[x](JaVa\tScRiPt:alert(1))')).not.toMatch(/javascript:/i)
    expect(render('[x](&#106;avascript:alert(1))')).not.toMatch(/javascript:/i)
  })
  it('keeps the clobber prefix for id/name (no raw HTML, so no ids are emitted at all)', () => {
    expect(readmeSchema.clobberPrefix).toBe('user-content-')
    expect(readmeSchema.clobber).toEqual(expect.arrayContaining(['id', 'name']))
    expect(render('# Title')).not.toMatch(/\sid=/)
  })
  it('keeps anchor-only links', () => {
    expect(render('[go](#usage)')).toContain('href="#usage"')
  })
})

describe('renderReadme: URL rewriting', () => {
  it('relative image -> raw.githubusercontent URL', () => {
    expect(render('![s](docs/shot.png)')).toContain(`src="${RAW}/docs/shot.png"`)
    expect(render('![s](./docs/shot.png)')).toContain(`src="${RAW}/docs/shot.png"`)
    expect(render('![s](/docs/shot.png)')).toContain(`src="${RAW}/docs/shot.png"`)
  })
  it('relative link -> github blob URL', () => {
    expect(render('[d](docs/GUIDE.md)')).toContain(`href="${BLOB}/docs/GUIDE.md"`)
  })
  it('keeps query of a relative link', () => {
    expect(render('[d](docs/GUIDE.md?plain=1)')).toContain(`href="${BLOB}/docs/GUIDE.md?plain=1"`)
  })
  it('keeps hash of a relative link', () => {
    expect(render('[d](docs/GUIDE.md#intro)')).toContain(`href="${BLOB}/docs/GUIDE.md#intro"`)
  })
  it('uses the given owner, repo and branch (branch with slash)', () => {
    const h = renderReadme('![s](a.png)', { owner: 'o', repo: 'r.x', branch: 'feat/x', dir: '' })
    expect(h).toContain('src="https://raw.githubusercontent.com/o/r.x/feat/x/a.png"')
  })
  it('images on any https host are kept (badges)', () => {
    const h = render('![b](https://img.shields.io/badge/a-b-green.svg)')
    expect(h).toContain('src="https://img.shields.io/badge/a-b-green.svg"')
  })
  it('non-https images are dropped', () => {
    expect(render('![b](http://img.shields.io/x.svg)')).not.toContain('<img')
  })
  it('absolute http/https links are kept', () => {
    expect(render('[a](https://example.com/x) [b](http://example.com/y)')).toContain('href="http://example.com/y"')
  })
  it('.. collapses and can never escape the repo root', () => {
    expect(render('![s](a/../b.png)')).toContain(`src="${RAW}/b.png"`)
    const h = render('![s](../../../../etc/passwd)\n\n[l](../../../other/repo)')
    expect(h).toContain(`src="${RAW}/etc/passwd"`)
    expect(h).toContain(`href="${BLOB}/other/repo"`)
  })
  it('encoded and backslash dot-segments cannot escape either', () => {
    const h = render('![s](%2e%2e/%2e%2e/x.png)\n\n![t](..\\\\..\\\\y.png)')
    expect(h).toContain(`src="${RAW}/x.png"`)
    expect(h).toContain(`src="${RAW}/y.png"`)
  })
  it('malformed percent-encoding is dropped, not thrown', () => {
    expect(() => render('![s](%E0%A4%A.png)')).not.toThrow()
    expect(render('![s](%E0%A4%A.png)')).not.toContain('<img')
  })
  it('protocol-relative //host is not treated as relative: dropped', () => {
    const h = render('![s](//evil.test/a.png)\n\n[l](//evil.test/x)')
    expect(h).not.toContain('evil.test')
    expect(h).not.toContain('<img')
  })
  it('path segments are percent-encoded', () => {
    expect(render('![s](<my dir/a b.png>)')).toContain(`src="${RAW}/my%20dir/a%20b.png"`)
  })
  it('resolves relative URLs from the README directory, never above root', () => {
    const c = { ...ctx, dir: 'docs' }
    expect(render('![s](shot.png)', c)).toContain(`src="${RAW}/docs/shot.png"`)
    expect(render('![s](/x.png)', c)).toContain(`src="${RAW}/x.png"`)
    expect(render('![s](../x.png)', c)).toContain(`src="${RAW}/x.png"`)
    expect(render('![s](../../../x.png)', c)).toContain(`src="${RAW}/x.png"`)
    expect(render('[l](g.md)', c)).toContain(`href="${BLOB}/docs/g.md"`)
  })
  it('HTTPS:// image scheme is kept (case-insensitive)', () => {
    expect(render('![b](HTTPS://img.shields.io/a.svg)')).toContain('<img')
  })
  it('branch with . or .. segments falls back to HEAD', () => {
    for (const branch of ['..', 'a/../b', './x', '.']) {
      const h = renderReadme('![s](a.png)', { ...ctx, branch })
      expect(h).toContain('src="https://raw.githubusercontent.com/LeongJinZhou/demo/HEAD/a.png"')
    }
  })
  it('oversized README (> 256 KB) renders as empty', () => {
    expect(render('a'.repeat(256 * 1024 + 1))).toBe('')
    expect(render('a'.repeat(256 * 1024))).not.toBe('')
  })
})
