/**
 * Le classement, affiché sur le seul poste de l'organisateur.
 *
 * Les joueurs, eux, n'ont vu que leur propre campagne, et ne verront jamais
 * cet écran : la révélation se fait à la voix, devant la salle.
 */

import type { SessionClient } from '../../session/client'
import type { RankingEntry } from '../../session/protocol'
import { buildRankings, moneyBasisNote, moneyColumnLabel } from '../../session/ranking'

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

function euros(value: number): string {
  return `${Math.round(value).toLocaleString('fr-FR')} €`
}

export class RankingScreen {
  readonly root: HTMLElement
  private readonly body: HTMLElement
  private stop: (() => void) | null = null
  private readonly client: SessionClient

  constructor(parent: HTMLElement, client: SessionClient, onClose: () => void) {
    this.root = el('div', 'overlay session-overlay')
    const card = el('div', 'overlay-card wide session-card')

    card.append(el('h1', 'title', 'Classement de la session'))
    this.body = el('div', 'session-ranking')
    card.append(this.body)

    const again = el('button', 'ghost-button large', 'Terminer')
    again.addEventListener('click', onClose)
    const buttons = el('div', 'button-row')
    buttons.append(again)
    card.append(buttons)

    this.root.append(card)
    parent.append(this.root)

    this.client = client
    this.render([], 0)
    this.stop = client.onChange((view) => this.render(view.ranking, view.pending))
    client.requestRanking()
  }

  private render(entries: readonly RankingEntry[], pending: number): void {
    this.body.replaceChildren()

    if (entries.length === 0) {
      this.body.append(el('p', 'muted', 'En attente des résultats…'))
      return
    }

    const { byTonnes, byMoney, moneyBasis } = buildRankings(entries)

    const note = moneyBasisNote(moneyBasis)
    if (note) this.body.append(el('p', 'session-basis-note', note))

    const columns = el('div', 'session-boards')
    columns.append(
      this.board('Au tonnage', byTonnes, 'Récolte', (entry) => `${entry.tonnes.toFixed(1)} t`),
      this.board(
        moneyBasis === 'marge' ? 'À la marge' : 'À l’engagement',
        byMoney,
        moneyColumnLabel(moneyBasis),
        (entry) => euros(moneyBasis === 'marge' ? entry.margin : entry.spent),
      ),
    )
    this.body.append(columns)

    if (pending > 0) {
      // Tant que le chrono tourne, un manquant est un joueur encore en train de
      // jouer : le tableau se complétera tout seul. Une fois l'échéance passée,
      // c'est un poste qu'on ne reverra pas.
      const closed = (this.client.remainingMs() ?? 0) <= 0
      const many = pending > 1

      this.body.append(
        el(
          'p',
          'muted',
          closed
            ? many
              ? `${pending} postes n’ont pas transmis leur résultat final : ils sont classés ` +
                'sur leur dernière position connue.'
              : 'Un poste n’a pas transmis son résultat final : il est classé sur sa dernière ' +
                'position connue.'
            : many
              ? `${pending} joueurs n’ont pas encore terminé. Le classement se complète à ` +
                'mesure qu’ils rendent.'
              : 'Un joueur n’a pas encore terminé. Le classement se complétera de lui-même.',
        ),
      )
    }
  }

  private board(
    title: string,
    entries: readonly RankingEntry[],
    valueLabel: string,
    value: (entry: RankingEntry) => string,
  ): HTMLElement {
    const block = el('div', 'session-board')
    block.append(el('h2', 'section-title', title))

    const table = el('table', 'result-table')
    const head = el('tr')
    head.append(el('th', '', ''), el('th', '', 'Joueur'), el('th', '', valueLabel))
    table.append(head)

    entries.forEach((entry, index) => {
      const row = el('tr', index === 0 ? 'is-first' : '')
      const name = el('td', '', entry.pseudo)
      if (!entry.complete) {
        name.append(el('span', 'session-partial', ` arrêté au tour ${entry.turn}`))
      }
      row.append(el('td', 'session-rank', `${index + 1}`), name, el('td', 'mono', value(entry)))
      table.append(row)
    })

    block.append(table)
    return block
  }

  dispose(): void {
    this.stop?.()
    this.root.remove()
  }
}
