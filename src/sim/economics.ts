/**
 * Référentiel économique.
 *
 * Les chiffres viennent de sources publiques françaises :
 *  — rendements et prix : Agreste (Bilan conjoncturel 2025, Infos Rapides 2024-2026)
 *  — charges opérationnelles : synthèse « Mes Parcelles » Hauts-de-France,
 *    récolte 2024, qui recense les charges réellement enregistrées par des
 *    agriculteurs (et non un itinéraire théorique)
 *  — maïs et tournesol : fiches marge brute de la Chambre d'agriculture des
 *    Landes, millésime 2023, seul jeu complet trouvé pour ces deux cultures
 *  — coûts complets betterave : ARTB
 *
 * Les prix sont volontairement exprimés en fourchette : sur 2020-2026, le blé
 * est passé de 139 à 415 €/t et le colza de 458 à 1 004 €/t. Un jeu qui fixerait
 * un prix unique raterait la moitié du métier.
 */

import type { CropId } from './crops'

export interface PriceBand {
  /** Prix bas observé sur 2020-2026, €/t. */
  readonly low: number
  /** Prix médian de référence, €/t. */
  readonly mid: number
  /** Prix haut observé sur 2020-2026, €/t. */
  readonly high: number
}

export interface CostBreakdown {
  /** Semences, €/ha. */
  readonly seed: number
  /** Fertilisation complète (NPK), €/ha, pour la dose de référence. */
  readonly fertiliser: number
  /** Herbicides sur le cycle, €/ha — poste subi, non pilotable au tour. */
  readonly herbicide: number
  /** Coût d'un passage fongicide, €/ha. */
  readonly fungicidePass: number
  /** Coût d'un passage insecticide, €/ha. */
  readonly insecticidePass: number
  /** Régulateur de croissance (anti-verse), €/ha. */
  readonly growthRegulator: number
  /** Frais de récolte spécifiques (arrachage betterave, séchage maïs), €/ha. */
  readonly harvestExtra: number
}

export interface CropEconomics {
  readonly price: PriceBand
  readonly costs: CostBreakdown
  /** Nombre de passages fongicides d'un itinéraire complet. */
  readonly fungicidePasses: number
  /** Nombre de passages insecticides d'un itinéraire complet. */
  readonly insecticidePasses: number
  /** Marge brute moyenne constatée, €/ha — sert de repère d'équilibrage. */
  readonly referenceGrossMargin: number
}

/**
 * Un tour d'irrigation apporte 30 mm.
 * Coût complet ≈ 0,31 €/m³ pour une réserve de substitution, soit environ
 * 90 €/ha les 300 m³. Sur maïs, un tour rapporte plus de 10 q/ha en année
 * sèche : le ratio bénéfice/coût est d'environ 2 pour 1.
 */
export const IRRIGATION_PASS_MM = 30
export const IRRIGATION_PASS_COST_PER_HA = 92

/** Coût d'un apport d'azote fractionné, €/ha, hors dose totale. */
export const NITROGEN_SPLIT_COST_PER_HA = 18

export const ECONOMICS: Record<CropId, CropEconomics> = {
  'ble-tendre-hiver': {
    price: { low: 139, mid: 192, high: 315 },
    costs: {
      seed: 87,
      fertiliser: 257,
      herbicide: 74,
      fungicidePass: 28,
      insecticidePass: 12,
      growthRegulator: 6,
      harvestExtra: 0,
    },
    fungicidePasses: 2,
    insecticidePasses: 1,
    referenceGrossMargin: 1446,
  },
  'orge-hiver': {
    price: { low: 150, mid: 185, high: 293 },
    costs: {
      seed: 79,
      fertiliser: 211,
      herbicide: 71,
      fungicidePass: 30,
      insecticidePass: 12,
      // L'escourgeon verse facilement : le régulateur y coûte plus cher qu'en blé.
      growthRegulator: 10,
      harvestExtra: 0,
    },
    fungicidePasses: 2,
    insecticidePasses: 1,
    referenceGrossMargin: 1187,
  },
  'colza-hiver': {
    price: { low: 458, mid: 500, high: 1004 },
    costs: {
      seed: 57,
      fertiliser: 320,
      // Poste dominant du colza, très au-dessus des céréales.
      herbicide: 115,
      fungicidePass: 34,
      // Contre-intuitif : quatre passages insecticides ne coûtent que ~18 €/ha.
      // La sanction des ravageurs n'est pas le prix du produit, c'est la perte
      // de rendement voire le retournement de la parcelle.
      insecticidePass: 5,
      growthRegulator: 0,
      harvestExtra: 0,
    },
    fungicidePasses: 1,
    insecticidePasses: 4,
    referenceGrossMargin: 1308,
  },
  'orge-printemps': {
    price: { low: 160, mid: 200, high: 390 },
    costs: {
      seed: 91,
      fertiliser: 177,
      herbicide: 49,
      fungicidePass: 30,
      insecticidePass: 10,
      growthRegulator: 8,
      harvestExtra: 0,
    },
    fungicidePasses: 1,
    insecticidePasses: 0,
    referenceGrossMargin: 1017,
  },
  'mais-grain': {
    price: { low: 150, mid: 180, high: 330 },
    costs: {
      seed: 226,
      fertiliser: 478,
      herbicide: 76,
      fungicidePass: 0,
      insecticidePass: 22,
      growthRegulator: 0,
      // Séchage : ~20 €/t à 21 % d'humidité, soit ~170 €/ha à 85 q/ha.
      harvestExtra: 170,
    },
    fungicidePasses: 0,
    insecticidePasses: 1,
    referenceGrossMargin: 1000,
  },
  tournesol: {
    price: { low: 400, mid: 475, high: 520 },
    costs: {
      seed: 124,
      fertiliser: 156,
      herbicide: 93,
      fungicidePass: 0,
      insecticidePass: 18,
      growthRegulator: 0,
      // Récolté à 9-11 % d'humidité : pas de séchage.
      harvestExtra: 0,
    },
    fungicidePasses: 0,
    insecticidePasses: 0,
    referenceGrossMargin: 503,
  },
  betterave: {
    price: { low: 25, mid: 36, high: 51 },
    costs: {
      seed: 289,
      fertiliser: 248,
      herbicide: 174,
      fungicidePass: 27,
      insecticidePass: 27,
      growthRegulator: 0,
      // Arrachage par entreprise : plus d'un planteur sur deux y recourt.
      harvestExtra: 340,
    },
    fungicidePasses: 2,
    insecticidePasses: 1,
    referenceGrossMargin: 1809,
  },
}

export function economicsOf(crop: CropId): CropEconomics {
  return ECONOMICS[crop]
}

/** Charges engagées d'office dès qu'on implante la culture, €/ha. */
export function establishmentCostPerHa(crop: CropId): number {
  const { costs } = economicsOf(crop)
  return costs.seed + costs.herbicide
}

/**
 * Prix de campagne tiré au sort.
 * Les prix agricoles sont anti-corrélés au rendement national : une mauvaise
 * année de récolte se paie mieux. On transmet donc l'indice de rendement de
 * l'année pour incliner le tirage dans le bon sens.
 */
export function rollPrice(crop: CropId, yieldIndex: number, roll: number): number {
  const { price } = economicsOf(crop)
  // yieldIndex 1 = année moyenne. En dessous, on remonte vers le haut de bande.
  const scarcity = Math.max(-1, Math.min(1, (1 - yieldIndex) * 1.4))
  const t = Math.max(0, Math.min(1, roll * 0.7 + 0.15 + scarcity * 0.35))
  return t < 0.5
    ? price.low + (price.mid - price.low) * (t / 0.5)
    : price.mid + (price.high - price.mid) * ((t - 0.5) / 0.5)
}

/** Budget de trésorerie disponible en début de campagne, en euros. */
export const STARTING_BUDGET = 62000

/**
 * Repère d'équilibrage : sur ~96 ha, un assolement classique engage environ
 * 55 000 € de charges opérationnelles. Le budget de départ laisse donc une
 * marge de manœuvre réelle mais pas confortable — il faut arbitrer.
 */
export const REFERENCE_OPERATING_COST = 55000

// ---------------------------------------------------------------- structure

/**
 * Charges de structure, €/ha/campagne.
 *
 * Ce sont celles qui tombent qu'on récolte ou non, et c'est exactement ce qui
 * manquait au jeu : sans elles, ne rien faire ne coûtait rien, et la marge
 * brute d'un assolement moyen suffisait à finir confortablement. Une
 * exploitation céréalière réelle porte 700 à 900 €/ha de charges de structure ;
 * on ne retient ici que celles qui sortent de la trésorerie de la campagne —
 * fermage, entretien et carburant du parc, assurances, cotisations — en
 * laissant de côté les amortissements et le prélèvement privé.
 */
export const STRUCTURE_COSTS_PER_HA = {
  /** Fermage moyen des terres arables, barème préfectoral. */
  fermage: 168,
  /**
   * Carburant, entretien, pièces, renouvellement du parc.
   * C'est le premier poste de structure d'une exploitation de grande culture,
   * et le plus difficile à comprimer : la moissonneuse coûte qu'elle serve
   * quinze jours ou quarante.
   */
  mecanisation: 268,
  /** Multirisque exploitation, responsabilité civile, grêle sur bâtiments. */
  assurances: 48,
  /** MSA, comptabilité, conseil, analyses de terre. */
  cotisations: 82,
  /** Électricité, téléphone, eau, entretien des bâtiments, petit outillage. */
  fraisGeneraux: 74,
} as const

export const STRUCTURE_COST_PER_HA = Object.values(STRUCTURE_COSTS_PER_HA).reduce(
  (sum, value) => sum + value,
  0,
)

// ---------------------------------------------------------------- banque

/**
 * Découvert autorisé, en euros.
 *
 * Une campagne se finance à crédit : les charges partent en août, les recettes
 * rentrent en juillet. La banque suit — jusqu'à un point. Au-delà, elle refuse
 * le paiement, et il faut renoncer à l'intervention.
 */
export const OVERDRAFT_LIMIT = 62000

/**
 * Taux du découvert, par quinzaine.
 * Un court terme agricole tourne autour de 6 % l'an ; rapporté à une période de
 * quinze jours, cela fait 0,25 %. C'est peu à l'échelle d'un tour, et lourd sur
 * une campagne passée dans le rouge.
 */
export const OVERDRAFT_RATE_PER_TURN = 0.0025

// ---------------------------------------------------------------- ETA

/**
 * Tarifs d'entreprise de travaux agricoles, €/ha, barème d'entraide 2024.
 *
 * Faire appel à une ETA, c'est acheter du temps : la moisson se fait en une
 * journée au lieu d'immobiliser toute la fenêtre. Sur une exploitation qui n'a
 * qu'une moissonneuse et quinze jours de beau temps, c'est parfois la seule
 * façon de rentrer la récolte — et ça coûte le prix.
 */
export const ETA_HARVEST_COST_PER_HA: Record<CropId, number> = {
  'ble-tendre-hiver': 165,
  'orge-hiver': 165,
  'orge-printemps': 165,
  'colza-hiver': 175,
  'mais-grain': 205,
  tournesol: 185,
  // Arracheuse intégrale six rangs : le chantier le plus cher de la campagne.
  betterave: 495,
}

/**
 * Nombre de chantiers que l'entreprise peut prendre dans un même tour.
 *
 * En pleine moisson, toute la plaine appelle en même temps. Sans cette limite,
 * l'ETA effacerait purement et simplement la contrainte de jours ouvrables et
 * il suffirait d'avoir de l'argent — or c'est le contraire qu'on veut montrer.
 */
export const ETA_CHANTIERS_PER_TURN = 2

/** Part du chantier qui reste à la charge de l'exploitant (bennes, logistique). */
export const ETA_DAYS_SHARE = 0.18
