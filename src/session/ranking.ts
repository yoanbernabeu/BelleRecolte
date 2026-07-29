/**
 * Les deux classements.
 *
 * Deux tableaux plutôt qu'un seul : le tonnage récompense l'audace, les euros
 * la maîtrise des coûts. Deux logiques opposées, donc deux vainqueurs
 * possibles — et bien plus de monde sur le podium.
 */

import type { RankingEntry } from './protocol'

export type MoneyBasis = 'marge' | 'engagement'

export interface Rankings {
  /** Du plus gros tonnage au plus faible. */
  readonly byTonnes: readonly RankingEntry[]
  /** Du meilleur résultat financier au pire, selon la base retenue. */
  readonly byMoney: readonly RankingEntry[]
  /**
   * Sur quoi le classement financier a été établi.
   *
   * `marge` en temps normal. `engagement` quand personne n'a rien récolté :
   * classer alors à la marge reviendrait à couronner celui qui n'a rien tenté,
   * puisque chaque euro dépensé creuse un déficit qu'aucune recette ne vient
   * combler. On mesure donc le travail engagé plutôt que le résultat.
   */
  readonly moneyBasis: MoneyBasis
}

export function buildRankings(entries: readonly RankingEntry[]): Rankings {
  const nobodyHarvested = entries.length > 0 && entries.every((entry) => entry.tonnes <= 0)
  const moneyBasis: MoneyBasis = nobodyHarvested ? 'engagement' : 'marge'

  const byTonnes = [...entries].sort(
    (a, b) => b.tonnes - a.tonnes || b.margin - a.margin || a.pseudo.localeCompare(b.pseudo),
  )

  const byMoney = [...entries].sort((a, b) =>
    moneyBasis === 'marge'
      ? b.margin - a.margin || b.tonnes - a.tonnes || a.pseudo.localeCompare(b.pseudo)
      : b.spent - a.spent || b.turn - a.turn || a.pseudo.localeCompare(b.pseudo),
  )

  return { byTonnes, byMoney, moneyBasis }
}

/** Intitulé de la colonne financière, selon ce qu'elle mesure réellement. */
export function moneyColumnLabel(basis: MoneyBasis): string {
  return basis === 'marge' ? 'Marge' : 'Engagé'
}

/**
 * Ce qu'il faut dire à la salle quand le classement bascule.
 * Mieux vaut l'annoncer que laisser dix marges négatives sans explication.
 */
export function moneyBasisNote(basis: MoneyBasis): string | null {
  return basis === 'engagement'
    ? 'Personne n’a moissonné avant l’échéance : le classement financier retient donc les ' +
        'frais engagés — ce qui a réellement été mis en culture — et non la marge, qui ' +
        'récompenserait l’immobilisme.'
    : null
}
