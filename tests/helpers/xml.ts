// Tiny well-formedness check for the SVGs we generate (no XML parser dependency): one root, balanced tags, quoted attributes, valid entities.
export function assertWellFormedXml(xml: string): void {
  if (/&(?!#\d+;|#x[0-9a-fA-F]+;|(?:amp|lt|gt|quot|apos);)/.test(xml)) throw new Error('bad entity')
  const stack: string[] = []
  let roots = 0
  for (const m of xml.matchAll(/<[^>]*>|[^<]+/g)) {
    const tok = m[0]
    if (!tok.startsWith('<')) {
      if (tok.includes('>') && tok.trim()) throw new Error('stray ">" in text')
      if (stack.length === 0 && tok.trim()) throw new Error('text outside root')
      continue
    }
    const t = tok.match(/^<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>$/)
    if (!t) throw new Error(`bad tag: ${tok}`)
    const [, close, name = '', , selfClose] = t
    if (close) {
      if (stack.pop() !== name) throw new Error(`unbalanced </${name}>`)
      continue
    }
    if (stack.length === 0 && ++roots > 1) throw new Error('more than one root')
    if (!selfClose) stack.push(name)
  }
  if (stack.length || roots !== 1) throw new Error('unclosed or missing root')
}
