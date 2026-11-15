import type { Element, Root } from 'hast'
import rehypeSanitize, { defaultSchema, type Options } from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

export interface ReadmeCtx {
  owner: string
  repo: string
  branch: string
  /** Directory of the README in the repo ("" = root). */
  dir: string
}

const MAX_BYTES = 256 * 1024

// Raw HTML is never parsed (no allowDangerousHtml, no rehype-raw); only http(s) URLs survive.
export const readmeSchema: Options = {
  ...defaultSchema,
  protocols: { ...defaultSchema.protocols, href: ['http', 'https'], src: ['http', 'https'] },
}

const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/')

/** Repo-relative path -> absolute URL under `base`; null when unusable. `..` stops at the repo root. */
function resolve(base: string, dir: string, rel: string): string | null {
  const m = rel.match(/^([^?#]*)(.*)$/s)
  let path: string
  try {
    path = decodeURIComponent(m?.[1] ?? '').replaceAll('\\', '/')
  } catch {
    return null
  }
  const out: string[] = []
  for (const seg of (path.startsWith('/') ? path : `${dir}/${path}`).split('/')) {
    if (seg === '..') out.pop()
    else if (seg !== '' && seg !== '.') out.push(seg)
  }
  return `${base}/${enc(out.join('/'))}${m?.[2] ?? ''}`
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

export function renderReadme(markdown: string, ctx: ReadmeCtx): string {
  const slug = `${encodeURIComponent(ctx.owner)}/${encodeURIComponent(ctx.repo)}`
  if (Buffer.byteLength(markdown) > MAX_BYTES) return ''
  const segs = ctx.branch.split('/')
  const branch = segs.includes('.') || segs.includes('..') ? 'HEAD' : enc(ctx.branch)
  const bases = { src: `https://raw.githubusercontent.com/${slug}/${branch}`, href: `https://github.com/${slug}/blob/${branch}` }

  const walk = (parent: Root | Element) => {
    for (let i = 0; i < parent.children.length; i++) {
      const node = parent.children[i]
      if (node?.type !== 'element') continue
      const attr = node.tagName === 'img' ? 'src' : node.tagName === 'a' ? 'href' : null
      const v = attr && node.properties[attr]
      if (attr && typeof v === 'string') {
        const url = v.trim()
        let next: string | null
        if (url.startsWith('#') || SCHEME.test(url)) next = url // sanitizer judges schemes
        else if (url.startsWith('//')) next = null
        else next = resolve(bases[attr], ctx.dir, url)
        // Non-https images are dropped whole (rule 7).
        if (attr === 'src' && !/^https:/i.test(next ?? '')) {
          parent.children.splice(i--, 1)
          continue
        }
        if (next === null) delete node.properties[attr]
        else node.properties[attr] = next
      }
      walk(node)
    }
  }
  const rewrite = () => (tree: Root) => walk(tree)

  return String(
    unified()
      .use(remarkParse)
      .use(remarkRehype)
      .use(rewrite)
      .use(rehypeSanitize, readmeSchema)
      .use(rehypeStringify)
      .processSync(markdown),
  )
}
