/**
 * Assurance récolte.
 *
 * Depuis la réforme de 2023, la multirisque climatique est subventionnée à 70 %
 * et s'articule avec la solidarité nationale : l'exploitant garde une franchise,
 * l'assureur couvre au-delà, l'État prend le relais sur les pertes
 * exceptionnelles. On ne modélise ici que le contrat lui-même.
 *
 * Le pari est volontairement serré. Une prime qui rapporterait à tous les coups
 * ne serait pas un choix, et une prime qui ne rapporterait jamais non plus : sur
 * une longue série d'années, l'assurance coûte un peu plus qu'elle ne rend —
 * c'est le prix de ne pas perdre la ferme sur une seule campagne.
 */

import { economicsOf } from './economics'
import { getCrop, type CropId } from './crops'

/**
 * Fenêtre de souscription, en nombre de tours après le semis.
 *
 * On assure une culture qu'on vient d'implanter, pas une culture dont on voit
 * déjà qu'elle est ratée. Deux tours, c'est le temps de la déclaration de
 * surfaces — au-delà, l'assureur a le même œil que le joueur sur le champ.
 */
export const SUBSCRIPTION_WINDOW_TURNS = 2

/**
 * Prime nette de subvention, en part de la valeur assurée.
 * Sur les grandes cultures, les taux nets tournent autour de 3 à 5 % du chiffre
 * d'affaires assuré selon le niveau de franchise retenu.
 */
const PREMIUM_RATE = 0.058

/**
 * Franchise : part de la récolte de référence que l'exploitant garde à sa
 * charge. En dessous de ce seuil de perte, l'assurance ne verse rien.
 */
export const DEDUCTIBLE = 0.3

/** Part de la perte au-delà de la franchise réellement indemnisée. */
const INDEMNITY_RATE = 0.75

/**
 * Valeur assurée d'une parcelle, en euros.
 *
 * On assure un rendement de référence à un prix de référence — pas le rendement
 * qu'on espère. C'est la règle du contrat réel, et elle a l'avantage de ne pas
 * dépendre du tirage de prix de la campagne.
 */
export function insuredValue(crop: CropId, areaHa: number): number {
  const { referenceYield } = getCrop(crop)
  const { price } = economicsOf(crop)
  return referenceYield * price.mid * areaHa
}

/** Prime à payer pour couvrir cette parcelle, en euros. */
export function premiumFor(crop: CropId, areaHa: number): number {
  return Math.round(insuredValue(crop, areaHa) * PREMIUM_RATE)
}

/**
 * Indemnité due sur une parcelle assurée, en euros.
 *
 * `harvestedValue` est la recette réellement encaissée : une parcelle perdue
 * vaut zéro, une parcelle médiocre vaut ce qu'elle a rapporté. On compare à la
 * valeur assurée, on retire la franchise, on applique le taux d'indemnisation.
 */
export function indemnityFor(crop: CropId, areaHa: number, harvestedValue: number): number {
  const insured = insuredValue(crop, areaHa)
  const loss = insured - harvestedValue
  const franchise = insured * DEDUCTIBLE
  if (loss <= franchise) return 0
  return Math.round((loss - franchise) * INDEMNITY_RATE)
}
