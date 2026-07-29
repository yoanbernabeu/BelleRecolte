/** Écran de bilan de fin de campagne, superposé à la scène. */

import type { Campaign } from '../sim/engine'
import { getCrop } from '../sim/crops'
import { parcelDefinition } from '../sim/farm'
import { labelOfTurn } from '../sim/calendar'
import type { Record } from './records'

/**
 * En session, la campagne ne se rejoue pas : le bilan ne propose qu'une sortie,
 * vers le classement pour l'organisateur, vers l'accueil pour les autres.
 */
export interface ResultOptions {
  readonly singleActionLabel?: string
}

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

export class ResultScreen {
  readonly root: HTMLElement

  constructor(
    parent: HTMLElement,
    campaign: Campaign,
    records: readonly Record[],
    onReplay: () => void,
    onNewSeed: () => void,
    options: ResultOptions = {},
  ) {
    const result = campaign.result()
    this.root = el('div', 'overlay result-screen')

    const card = el('div', 'overlay-card wide')
    card.append(
      el('h1', 'title', result.interruptedAtTurn === null ? 'Fin de campagne' : 'Temps écoulé'),
    )
    card.append(el('p', 'year-name', result.yearName))
    card.append(el('p', 'subtitle', result.yearDescription))

    if (result.interruptedAtTurn !== null) {
      card.append(
        el(
          'p',
          'result-interrupted',
          `Vous en étiez à ${labelOfTurn(result.interruptedAtTurn)}. La campagne s’est achevée ` +
            'sans vous : ce qui restait en terre n’a pas été récolté, mais les charges de ' +
            'structure de l’année entière sont dues.',
        ),
      )
    }

    const totals = el('div', 'totals')
    totals.append(
      this.total('Récolte totale', `${result.totalTonnes.toFixed(1)} t`),
      this.total('Recettes', euros(result.totalRevenue)),
      this.total('Charges engagées', euros(result.totalSpent)),
      this.total('Marge', euros(result.margin), result.margin >= 0 ? 'is-good' : 'is-bad'),
    )
    card.append(totals)

    // Une perte doit être explicable, sinon elle est vécue comme arbitraire.
    // On montre donc d'où l'argent est parti, poste par poste, avant même le
    // détail parcellaire — c'est la première question qu'on se pose.
    card.append(el('h2', 'section-title', 'Où est passé l’argent'))
    const breakdown = el('div', 'result-breakdown')
    const posts: Array<[string, number, string]> = [
      ['Intrants et travaux', result.operatingCost, 'Semences, engrais, produits, irrigation, réapprovisionnements.'],
      ['Charges de structure', result.structureCost, 'Fermage, mécanisation, assurances, cotisations. Elles tombent quoi qu’il arrive.'],
      ['Entreprise de travaux', result.contractorCost, 'Chantiers confiés à l’ETA pour tenir les fenêtres.'],
      ['Assurance récolte', result.insuranceCost, 'Primes versées sur les parcelles couvertes.'],
      ['Agios', result.financialCost, 'Intérêts du découvert, prélevés chaque quinzaine passée dans le rouge.'],
    ]
    for (const [label, amount, why] of posts) {
      if (amount <= 0) continue
      const row = el('div', 'breakdown-row')
      const head = el('div', 'breakdown-head')
      head.append(el('span', 'breakdown-label', label), el('span', 'breakdown-value', euros(amount)))
      row.append(head, el('p', 'breakdown-why', why))
      breakdown.append(row)
    }
    if (result.insurancePayout > 0) {
      const row = el('div', 'breakdown-row is-credit')
      const head = el('div', 'breakdown-head')
      head.append(
        el('span', 'breakdown-label', 'Indemnités d’assurance'),
        el('span', 'breakdown-value', `+ ${euros(result.insurancePayout)}`),
      )
      row.append(head, el('p', 'breakdown-why', 'Versées sur les parcelles couvertes dont la récolte s’est effondrée.'))
      breakdown.append(row)
    }
    card.append(breakdown)

    card.append(
      el(
        'p',
        'result-verdict',
        result.margin >= 0
          ? `La campagne dégage ${euros(result.margin)}. C’est ce qui reste pour vivre, ` +
            'renouveler le matériel et aborder la campagne suivante.'
          : `La campagne coûte ${euros(-result.margin)}. Les recettes n’ont pas couvert les charges : ` +
            'l’exploitation entame son capital, et la campagne suivante démarrera plus contrainte.',
      ),
    )

    // Détail parcelle par parcelle
    const table = el('table', 'result-table')
    const head = el('tr')
    head.append(
      el('th', '', 'Parcelle'),
      el('th', '', 'Culture'),
      el('th', '', 'Rendement'),
      el('th', '', 'Récolte'),
      el('th', '', 'Recette'),
      el('th', '', 'Assurance'),
    )
    table.append(head)

    for (const state of campaign.parcels) {
      const definition = parcelDefinition(state.id)
      const row = el('tr')
      const crop = state.crop ? getCrop(state.crop) : null
      const perHa = state.harvestedTonnes / definition.areaHa
      const cover = !state.insured
        ? '—'
        : state.insurancePayout > 0
          ? `+ ${euros(state.insurancePayout)}`
          : `${euros(-state.insurancePremium)}`
      row.append(
        el('td', '', definition.name),
        el('td', '', crop ? crop.name : '—'),
        el('td', '', state.harvestedTonnes > 0 ? `${perHa.toFixed(1)} t/ha` : '—'),
        el('td', '', state.harvestedTonnes > 0 ? `${state.harvestedTonnes.toFixed(1)} t` : '—'),
        el('td', '', state.revenue > 0 ? euros(state.revenue) : '—'),
        el('td', state.insurancePayout > 0 ? 'is-credit' : '', cover),
      )
      if (state.crop && state.harvestedTonnes <= 0) row.classList.add('is-lost')
      table.append(row)
    }
    card.append(table)

    // Partage de la graine
    const share = el('div', 'share-row')
    share.append(el('span', '', 'Code de cette campagne :'), el('code', 'mono seed-chip', campaign.seedCode))
    const copy = el('button', 'ghost-button', 'Copier')
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(campaign.seedCode).then(
        () => {
          copy.textContent = 'Copié'
          window.setTimeout(() => (copy.textContent = 'Copier'), 1800)
        },
        () => {
          copy.textContent = 'Échec'
        },
      )
    })
    share.append(copy)
    card.append(share)

    const best = records[0]
    if (best) {
      card.append(
        el(
          'p',
          'muted',
          best.seed === campaign.seedCode && Math.abs(best.margin - result.margin) < 1
            ? 'C’est votre meilleure campagne à ce jour.'
            : `Votre record reste ${euros(best.margin)} sur la campagne ${best.seed}.`,
        ),
      )
    }

    const buttons = el('div', 'button-row')
    if (options.singleActionLabel) {
      const only = el('button', 'primary-button large', options.singleActionLabel)
      only.addEventListener('click', onReplay)
      buttons.append(only)
    } else {
      const replay = el('button', 'primary-button', 'Rejouer cette année')
      replay.addEventListener('click', onReplay)
      const fresh = el('button', 'ghost-button large', 'Nouvelle année')
      fresh.addEventListener('click', onNewSeed)
      buttons.append(replay, fresh)
    }
    card.append(buttons)

    this.root.append(card)
    parent.append(this.root)
  }

  private total(label: string, value: string, className = ''): HTMLElement {
    const node = el('div', `total ${className}`)
    node.append(el('span', 'total-label', label), el('span', 'total-value', value))
    return node
  }

  remove(): void {
    this.root.remove()
  }
}
