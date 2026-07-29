/**
 * Ce qu'un poste déclare au serveur.
 *
 * Un score n'a de sens que rapporté à une campagne entière. Comme le chrono
 * peut tomber au milieu du printemps, on ne transmet jamais la trésorerie
 * courante mais celle qu'on aurait si la partie s'arrêtait maintenant : les
 * charges de structure des tours qui restent y sont déjà retranchées.
 */

import { TURNS_PER_CAMPAIGN } from '../sim/calendar'
import { STRUCTURE_COST_PER_HA } from '../sim/economics'
import type { Campaign } from '../sim/engine'
import { TOTAL_AREA_HA } from '../sim/farm'
import type { ScoreReport } from './protocol'

/** Charges de structure d'un tour, telles que le moteur les prélève. */
const STRUCTURE_PER_TURN = Math.round((STRUCTURE_COST_PER_HA * TOTAL_AREA_HA) / TURNS_PER_CAMPAIGN)

/**
 * Le score de cette campagne si le chrono tombait à l'instant.
 *
 * Les agios des tours restants sont ignorés : quelques dizaines d'euros sur une
 * campagne entière, sans effet sur un classement, et le calcul exact suppose de
 * dérouler le découvert tour après tour. La clôture réelle, elle, les compte —
 * cette projection ne sert qu'aux remontées de secours d'un poste qui
 * disparaîtrait avant l'échéance.
 */
export function projectScore(campaign: Campaign): ScoreReport {
  const result = campaign.result()
  const remaining = Math.max(0, TURNS_PER_CAMPAIGN - campaign.turn)
  const owed = campaign.finished ? 0 : STRUCTURE_PER_TURN * remaining

  return {
    tonnes: Math.round(result.totalTonnes * 10) / 10,
    margin: Math.round(result.margin - owed),
    spent: Math.round(result.totalSpent + owed),
    turn: campaign.turn,
  }
}
