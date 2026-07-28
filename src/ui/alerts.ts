/**
 * Alertes de parcelles en danger.
 *
 * Après chaque tour, les parcelles qui appellent une décision remontent ici.
 * Sans ce dispositif, un joueur qui ne scrute pas ses huit cartes découvre le
 * problème quand la culture est déjà perdue — et le jeu paraît injuste alors
 * qu'il était seulement silencieux.
 *
 * Les alertes sont cliquables : elles ouvrent directement la parcelle concernée.
 */

import type { ParcelDanger } from '../sim/engine'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export class AlertStack {
  readonly root: HTMLElement
  private readonly timers = new Map<HTMLElement, number>()

  constructor(parent: HTMLElement, private readonly onFocus: (parcelId: number) => void) {
    this.root = el('div', 'alert-stack')
    this.root.setAttribute('role', 'status')
    this.root.setAttribute('aria-live', 'polite')
    parent.append(this.root)
  }

  /** Remplace les alertes affichées par celles du tour qui vient de se dérouler. */
  show(dangers: readonly ParcelDanger[]): void {
    this.clear()
    if (dangers.length === 0) return

    // Ce qui vient de tomber d'abord, puis ce qui menace, et pas plus de cinq :
    // au-delà on ne lit plus.
    const rank = { sinistre: 0, critique: 1, alerte: 2 } as const
    const ordered = [...dangers].sort((a, b) => rank[a.severity] - rank[b.severity])
    const labels = { sinistre: 'Sinistre', critique: 'Critique', alerte: 'À surveiller' } as const
    const delays = { sinistre: 13000, critique: 11000, alerte: 7500 } as const
    const shown = 5

    for (const danger of ordered.slice(0, shown)) {
      const card = el('button', `alert-card alert-${danger.severity}`)
      card.type = 'button'
      card.append(
        el('span', 'alert-severity', labels[danger.severity]),
        el('span', 'alert-title', danger.title),
        el('span', 'alert-message', danger.message),
      )
      card.addEventListener('click', () => {
        this.onFocus(danger.parcelId)
        this.dismiss(card)
      })
      this.root.append(card)

      // Un sinistre reste le plus longtemps : c'est la seule occasion de le lire.
      this.timers.set(card, window.setTimeout(() => this.dismiss(card), delays[danger.severity]))
    }

    const extra = ordered.length - shown
    if (extra > 0) {
      const more = el(
        'div',
        'alert-more',
        `et ${extra} autre${extra > 1 ? 's' : ''} parcelle${extra > 1 ? 's' : ''} à surveiller`,
      )
      this.root.append(more)
      // Ce libellé a besoin de son propre minuteur : sans lui, il survivait à
      // la disparition des cartes et restait seul en suspens à l'écran.
      this.timers.set(more, window.setTimeout(() => this.dismiss(more), 11000))
    }
  }

  private dismiss(card: HTMLElement): void {
    const timer = this.timers.get(card)
    if (timer !== undefined) window.clearTimeout(timer)
    this.timers.delete(card)
    card.classList.add('is-leaving')
    window.setTimeout(() => card.remove(), 320)
  }

  clear(): void {
    for (const timer of this.timers.values()) window.clearTimeout(timer)
    this.timers.clear()
    this.root.replaceChildren()
  }

  dispose(): void {
    this.clear()
    this.root.remove()
  }
}
