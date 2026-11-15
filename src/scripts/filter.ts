// Progressive enhancement: without this script every card stays visible and the controls stay hidden.
const root = document.querySelector<HTMLElement>('[data-filter]')

if (root) {
  const chips = [...root.querySelectorAll<HTMLButtonElement>('button[data-tech]')]
  const cards = [...document.querySelectorAll<HTMLElement>('#projects [data-testid="project-card"]')]
  const empty = document.querySelector<HTMLElement>('[data-testid="filter-empty"]')
  const status = root.querySelector<HTMLElement>('[data-count]')
  const selected = new Set<string>()

  const render = (announce = true) => {
    let shown = 0
    for (const card of cards) {
      const tech = (card.dataset.tech ?? '').split('|')
      const ok = [...selected].every((t) => tech.includes(t))
      card.hidden = !ok
      if (ok) shown++
    }
    for (const c of chips) c.setAttribute('aria-pressed', String(c.dataset.tech ? selected.has(c.dataset.tech) : selected.size === 0))
    if (empty) empty.hidden = shown > 0
    if (status && announce) status.textContent = `Showing ${shown} of ${cards.length} projects`
  }

  const reset = () => {
    selected.clear()
    render()
  }

  for (const c of chips)
    c.addEventListener('click', () => {
      const t = c.dataset.tech
      if (!t) return reset()
      if (!selected.delete(t)) selected.add(t)
      render()
    })
  empty?.querySelector('button')?.addEventListener('click', () => {
    reset()
    chips[0]?.focus() // the Reset button just hid; keep keyboard focus on the page
  })

  root.hidden = false
  render(false) // no live announcement on load
}
