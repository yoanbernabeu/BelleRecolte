/**
 * Contraintes réglementaires d'emploi des produits phytosanitaires.
 *
 * En France, chaque produit autorisé est inscrit au catalogue E-Phy de l'ANSES,
 * qui fixe ses conditions d'emploi : nombre maximal d'applications, intervalle
 * minimal entre deux passages, et surtout le **délai avant récolte** (DAR) —
 * le nombre de jours qui doivent séparer le dernier traitement de la moisson.
 *
 * Le DAR n'est pas une formalité : c'est ce qui garantit que les résidus soient
 * sous la limite maximale au moment de la récolte. Le dépasser rend le lot
 * incommercialisable.
 *
 * Dans le jeu, cela crée un arbitrage réel de fin de cycle : traiter tard pour
 * sauver une culture malade, c'est s'interdire de récolter pendant plusieurs
 * tours — et donc s'exposer aux orages de fin d'été.
 *
 * Valeurs de référence relevées sur les programmes réels :
 *   Propulse 7 j · Timbal EW 14 j · Passerelle 21 j · Révystar XL 28 j ·
 *   Amistar Gold 35 j. L'ITB recommande par ailleurs de ne plus intervenir
 *   à moins de 45 jours de l'arrachage sur betterave, et de respecter
 *   3 semaines entre deux traitements fongicides.
 */

import { periodAt, TURNS_PER_CAMPAIGN } from './calendar'
import type { CropId } from './crops'

export interface TreatmentRules {
  /** Délai avant récolte pour les fongicides, en jours. */
  readonly fungicidePreHarvestDays: number
  /** Délai avant récolte pour les insecticides, en jours. */
  readonly insecticidePreHarvestDays: number
  /** Intervalle minimal entre deux traitements de même nature, en jours. */
  readonly minIntervalDays: number
}

export const TREATMENT_RULES: Record<CropId, TreatmentRules> = {
  'ble-tendre-hiver': {
    fungicidePreHarvestDays: 35,
    insecticidePreHarvestDays: 30,
    minIntervalDays: 21,
  },
  'orge-hiver': {
    fungicidePreHarvestDays: 35,
    insecticidePreHarvestDays: 30,
    minIntervalDays: 21,
  },
  'orge-printemps': {
    fungicidePreHarvestDays: 35,
    insecticidePreHarvestDays: 30,
    minIntervalDays: 21,
  },
  'colza-hiver': {
    // Le fongicide sclérotinia se positionne à la chute des premiers pétales,
    // très en amont de la récolte : le délai est long.
    fungicidePreHarvestDays: 56,
    insecticidePreHarvestDays: 30,
    minIntervalDays: 21,
  },
  betterave: {
    // Recommandation ITB : plus aucune intervention à moins de 45 jours
    // de l'arrachage, et trois semaines entre deux passages.
    fungicidePreHarvestDays: 45,
    insecticidePreHarvestDays: 45,
    minIntervalDays: 21,
  },
  'mais-grain': {
    fungicidePreHarvestDays: 30,
    insecticidePreHarvestDays: 30,
    minIntervalDays: 21,
  },
  tournesol: {
    fungicidePreHarvestDays: 30,
    insecticidePreHarvestDays: 30,
    minIntervalDays: 21,
  },
}

export function rulesFor(crop: CropId): TreatmentRules {
  return TREATMENT_RULES[crop]
}

/**
 * Premier tour dont le début est distant d'au moins `days` jours de la fin du
 * tour courant. Les tours n'ayant pas tous la même durée — quinzaine en saison,
 * mois entier en hiver — on parcourt le calendrier plutôt que de diviser.
 */
export function turnAfterDays(fromTurn: number, days: number): number {
  let elapsed = 0
  let turn = fromTurn
  while (elapsed < days && turn < TURNS_PER_CAMPAIGN - 1) {
    turn += 1
    elapsed += periodAt(turn).days
  }
  return turn
}

/** Nombre de jours couverts entre deux tours, bornes comprises. */
export function daysBetween(fromTurn: number, toTurn: number): number {
  let days = 0
  for (let turn = fromTurn + 1; turn <= toTurn; turn++) days += periodAt(turn).days
  return days
}
