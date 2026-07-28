/**
 * Types de sol.
 *
 * Le sol conditionne la réserve utile (combien d'eau la parcelle peut stocker),
 * la vitesse de ressuyage et de réchauffement au printemps, et le potentiel de
 * rendement. C'est ce qui fait qu'une même météo ne produit pas le même
 * résultat sur deux parcelles voisines.
 */

export type SoilId = 'limon' | 'argilo-calcaire' | 'argile' | 'sable' | 'craie'

export interface Soil {
  readonly id: SoilId
  readonly name: string
  readonly description: string
  /** Réserve utile en mm — capacité de stockage d'eau accessible à la plante. */
  readonly waterCapacityMm: number
  /** Vitesse d'infiltration : <1 retient l'eau en surface, >1 draine vite. */
  readonly drainage: number
  /** Rapidité de réchauffement printanier : >1 sol précoce, <1 sol froid. */
  readonly warmth: number
  /** Multiplicateur de potentiel de rendement. */
  readonly yieldFactor: number
  /** Fourniture d'azote par la minéralisation, en unités N/ha sur le cycle. */
  readonly nitrogenSupply: number
  /** Risque d'excès d'eau hivernal (asphyxie racinaire), 0→1. */
  readonly waterloggingRisk: number
  /** Couleur de la terre nue, pour le rendu 3D. */
  readonly color: number
}

export const SOILS: Record<SoilId, Soil> = {
  limon: {
    id: 'limon',
    name: 'Limon profond',
    description:
      "Le sol des grandes plaines céréalières. Réserve d'eau confortable, se travaille bien, potentiel maximal.",
    waterCapacityMm: 180,
    drainage: 1,
    warmth: 1,
    yieldFactor: 1.1,
    nitrogenSupply: 45,
    waterloggingRisk: 0.2,
    color: 0x7a5c3e,
  },
  'argilo-calcaire': {
    id: 'argilo-calcaire',
    name: 'Argilo-calcaire',
    description:
      'Sol de coteau, peu profond et caillouteux. Se ressuie vite mais manque de fond en cas de sécheresse.',
    waterCapacityMm: 110,
    drainage: 1.15,
    warmth: 1.05,
    yieldFactor: 0.92,
    nitrogenSupply: 35,
    waterloggingRisk: 0.12,
    color: 0x9a8464,
  },
  argile: {
    id: 'argile',
    name: 'Argile lourde',
    description:
      "Retient très bien l'eau, mais froid au printemps et vite asphyxiant sous les pluies d'hiver.",
    waterCapacityMm: 200,
    drainage: 0.7,
    warmth: 0.82,
    yieldFactor: 1,
    nitrogenSupply: 50,
    waterloggingRisk: 0.45,
    color: 0x6b4f3f,
  },
  sable: {
    id: 'sable',
    name: 'Sable',
    description:
      "Se réchauffe très tôt et se travaille par tous les temps, mais l'eau file. Sans irrigation, l'été est rude.",
    // 85 mm : le bas de la fourchette réelle des sols sableux (70-100 mm de
    // réserve utile). À 70, la parcelle devenait quasiment sans valeur quelle
    // que soit la culture — ce qui n'est pas le cas dans la réalité.
    waterCapacityMm: 85,
    drainage: 1.45,
    warmth: 1.2,
    yieldFactor: 0.82,
    nitrogenSupply: 25,
    waterloggingRisk: 0.05,
    color: 0xa9926a,
  },
  craie: {
    id: 'craie',
    name: 'Craie',
    description:
      "Sol blanc filtrant qui remonte l'eau par capillarité. Régulier, sans excès dans un sens ni dans l'autre.",
    waterCapacityMm: 140,
    drainage: 1.25,
    warmth: 1.08,
    yieldFactor: 0.95,
    nitrogenSupply: 38,
    waterloggingRisk: 0.08,
    color: 0xbdb08c,
  },
}

export const SOIL_IDS = Object.keys(SOILS) as SoilId[]

export function getSoil(id: SoilId): Soil {
  return SOILS[id]
}
