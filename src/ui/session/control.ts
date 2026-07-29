/**
 * La régie.
 *
 * L'écran de l'organisateur qui a choisi de ne pas jouer. Il n'y voit ni les
 * campagnes ni les scores — seulement le temps qui passe. Le secret vaut aussi
 * pour lui : c'est ce qui rend la révélation finale intéressante.
 */

import type { SessionClient } from '../../session/client'
import { RankingScreen } from './ranking'
import { TimerBanner } from './timer'

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

export class ControlRoom {
  private readonly root: HTMLElement
  private readonly timer: TimerBanner
  private ranking: RankingScreen | null = null
  private revealed = false
  /** Nul tant que l'abonnement n'est pas posé : `reveal` peut partir avant. */
  private unsubscribe: (() => void) | null = null

  constructor(
    private readonly parent: HTMLElement,
    private readonly client: SessionClient,
    private readonly onClose: () => void,
  ) {
    this.root = el('div', 'overlay session-overlay')
    const card = el('div', 'overlay-card session-card')

    card.append(el('h1', 'title', 'Session en cours'))
    const seed = client.state.seed
    card.append(el('p', 'muted', seed ? `Campagne ${seed}, code ${client.state.code}.` : ''))

    const slot = el('div', 'session-timer-slot')
    card.append(slot)

    card.append(
      el(
        'p',
        'session-note',
        'Aucun résultat ne s’affiche avant la fin. Le classement apparaîtra de lui-même ' +
          'dès que tout le monde aura rendu, sans attendre l’échéance.',
      ),
    )

    // Le filet du cas bancal : une machine éteinte ne rendra jamais rien, et sa
    // salle n'a pas à attendre vingt minutes pour autant. L'organisateur voit
    // la pièce, il sait si le poste du fond est vraiment mort.
    const force = el('button', 'ghost-button', 'Clôturer maintenant')
    force.addEventListener('click', () => {
      client.requestRanking()
      this.reveal()
    })
    const buttons = el('div', 'button-row')
    buttons.append(force)
    card.append(buttons)

    this.root.append(card)
    parent.append(this.root)

    this.timer = new TimerBanner(slot, client, () => this.reveal())

    // Le serveur pousse le classement de lui-même dès que plus aucun poste ne
    // doit de résultat. Sans cette écoute, la régie l'ignorait et attendait
    // bêtement la fin du chrono.
    this.unsubscribe = client.onChange((view) => {
      if (view.ranking.length > 0 && view.pending === 0) this.reveal()
    })
  }

  /** Bascule vers le classement — à l'échéance, ou dès que tout le monde a rendu. */
  private reveal(): void {
    if (this.revealed) return
    this.revealed = true
    this.unsubscribe?.()
    // `timer` peut ne pas être encore assigné : un chrono déjà écoulé au montage
    // déclenche son échéance depuis son propre constructeur.
    this.timer?.dispose()
    this.root.remove()
    this.ranking = new RankingScreen(this.parent, this.client, () => {
      this.dispose()
      this.onClose()
    })
  }

  dispose(): void {
    this.unsubscribe?.()
    this.timer?.dispose()
    this.ranking?.dispose()
    this.root.remove()
    this.client.dispose()
  }
}
