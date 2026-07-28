/**
 * Aléas biologiques.
 *
 * La météo n'est pas la seule chose qui abîme une récolte. Une harde de
 * sangliers couche un hectare de maïs en une nuit, une bande de corbeaux
 * déterre un semis en trois jours, une automne doux et humide livre le colza
 * aux limaces avant même qu'il n'ait quatre feuilles.
 *
 * Ces trois-là ont en commun d'être locaux, brutaux et partiellement évitables.
 * Contrairement au gel ou à la sécheresse, ils ne se lisent pas dans les
 * prévisions : ils tombent sur une parcelle et pas sur sa voisine, et c'est
 * l'exposition de la parcelle — sa bordure de bois, sa culture, sa date de
 * semis — qui décide du risque.
 */

import type { CropId } from './crops'
import type { GrowthStage } from './engine'
import type { Weather } from './weather'

export type HazardId = 'sangliers' | 'corvides' | 'limaces'

export interface HazardContext {
  readonly crop: CropId
  readonly stage: GrowthStage
  readonly turn: number
  /** Tours écoulés depuis le semis. */
  readonly turnsSinceSowing: number
  /** La parcelle jouxte-t-elle un bois ? */
  readonly nearWoods: boolean
  readonly weather: Weather
  /** Eau du sol rapportée à la capacité, 0→1. */
  readonly soilMoisture: number
  /** La parcelle a-t-elle reçu un insecticide récemment ? */
  readonly recentlyTreated: boolean
}

export interface HazardStrike {
  readonly id: HazardId
  /** Perte de vigueur infligée, 0→1. */
  readonly damage: number
  readonly message: string
}

export interface HazardDefinition {
  readonly id: HazardId
  readonly name: string
  /** Probabilité de survenue sur un tour, une fois les conditions réunies. */
  readonly probability: (ctx: HazardContext) => number
  /** Ampleur des dégâts, tirée entre ces bornes. */
  readonly damage: readonly [number, number]
  readonly message: (damage: number) => string
}

/**
 * Le sanglier ne mange pas : il couche, il fouille et il souille. Une parcelle
 * de maïs au stade laiteux bordée de bois est la cible la plus classique du
 * calendrier agricole français, et les dégâts se comptent en hectares perdus,
 * pas en quintaux.
 */
const SANGLIERS: HazardDefinition = {
  id: 'sangliers',
  name: 'Sangliers',
  probability: (ctx) => {
    const appetising =
      ctx.crop === 'mais-grain' ? 1 : ctx.crop === 'ble-tendre-hiver' ? 0.4 : ctx.crop === 'orge-hiver' ? 0.35 : 0.15
    // Ils entrent quand il y a quelque chose à manger : grain laiteux ou épi fait.
    const attractive =
      ctx.stage === 'remplissage' || ctx.stage === 'mature' ? 1 : ctx.stage === 'floraison' ? 0.4 : 0
    // Une lisière de bois multiplie le risque par trois, elle ne le crée pas :
    // une compagnie traverse la plaine si le maïs en vaut la peine.
    const cover = ctx.nearWoods ? 1 : 0.34
    return appetising * attractive * cover * 0.32
  },
  damage: [0.1, 0.4],
  message: (damage) =>
    damage > 0.22
      ? 'les sangliers ont couché une partie de la parcelle cette nuit'
      : 'passage de sangliers en bordure de bois',
}

/**
 * Corbeaux freux et corneilles suivent le semoir. Le maïs et le tournesol sont
 * les cibles habituelles : la graine est grosse, nourrissante, et le semis est
 * espacé, donc le peuplement perdu ne se rattrape pas.
 */
const CORVIDES: HazardDefinition = {
  id: 'corvides',
  name: 'Corvidés',
  probability: (ctx) => {
    if (ctx.turnsSinceSowing > 2) return 0
    if (ctx.stage !== 'seme' && ctx.stage !== 'levee') return 0
    const target = ctx.crop === 'mais-grain' ? 1 : ctx.crop === 'tournesol' ? 0.9 : 0
    // Un temps sec laisse la graine accessible ; la pluie la fait lever vite.
    const dry = ctx.weather.rainMm < 22 ? 1 : 0.4
    const cover = ctx.nearWoods ? 1.25 : 0.8
    return target * dry * cover * 0.26
  },
  damage: [0.1, 0.3],
  message: (damage) =>
    damage > 0.2
      ? 'les corvidés ont ravagé le semis, le peuplement est très clair'
      : 'les corvidés ont prélevé une partie du semis',
}

/**
 * La limace n'attaque qu'à la levée, et seulement si le sol est humide et doux.
 * Un colza semé fin août dans un sol ressuyé passe entre les gouttes ; le même
 * colza dans un septembre pluvieux se fait raser.
 */
const LIMACES: HazardDefinition = {
  id: 'limaces',
  name: 'Limaces',
  probability: (ctx) => {
    if (ctx.stage !== 'seme' && ctx.stage !== 'levee') return 0
    const target =
      ctx.crop === 'colza-hiver' ? 1 : ctx.crop === 'ble-tendre-hiver' || ctx.crop === 'orge-hiver' ? 0.6 : 0.15
    // Humidité et douceur : les deux conditions doivent être réunies.
    const wet = Math.max(0, Math.min(1, (ctx.soilMoisture - 0.55) / 0.35))
    const mild = Math.max(0, Math.min(1, (ctx.weather.tempMean - 8) / 9))
    // L'insecticide posé récemment tient aussi les limaces à distance.
    const protection = ctx.recentlyTreated ? 0.3 : 1
    return target * wet * mild * protection * 0.42
  },
  damage: [0.08, 0.28],
  message: (damage) =>
    damage > 0.19
      ? 'les limaces ont dévoré la levée, il faudra peut-être ressemer'
      : 'dégâts de limaces sur la jeune culture',
}

export const HAZARDS: readonly HazardDefinition[] = [SANGLIERS, CORVIDES, LIMACES]

/** Nom court d'un aléa, pour l'afficher sur la parcelle qui l'a subi. */
export function hazardName(id: HazardId): string {
  return HAZARDS.find((hazard) => hazard.id === id)?.name ?? id
}

/**
 * Tire les aléas du tour pour une parcelle.
 *
 * Au plus un aléa par tour et par parcelle : deux catastrophes simultanées sur
 * le même champ se lisent comme un bug, pas comme une mauvaise année.
 */
export function rollHazards(ctx: HazardContext, random: () => number): HazardStrike | null {
  for (const hazard of HAZARDS) {
    const probability = hazard.probability(ctx)
    if (probability <= 0) continue
    if (random() >= probability) continue

    const [min, max] = hazard.damage
    const damage = min + random() * (max - min)
    return { id: hazard.id, damage, message: hazard.message(damage) }
  }
  return null
}
