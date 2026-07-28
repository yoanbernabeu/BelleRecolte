/**
 * Jours ouvrables.
 *
 * La contrainte qui pèse vraiment sur une exploitation n'est pas l'argent,
 * c'est le temps de travail mobilisable. Un exploitant seul ne traite pas
 * 96 hectares dans la journée — et surtout, il ne peut pas entrer dans un
 * champ détrempé ni pulvériser par vent fort.
 *
 * Chaque tour ouvre donc un capital de jours, calculé à partir de la météo.
 * Une quinzaine à dix jours de pluie n'en laisse que quatre. C'est ce qui
 * transforme une prévision pluvieuse en problème de planification plutôt
 * qu'en simple punition.
 */

import { periodAt } from './calendar'
import type { ActionKind } from './engine'
import { clamp } from './rng'
import type { Weather } from './weather'

/**
 * Coût en jours de travail par hectare, par type d'intervention.
 * La moisson est de loin le chantier le plus lourd : c'est ce qui rend la
 * fenêtre de récolte réellement tendue quand la météo se dégrade.
 */
const DAYS_PER_HECTARE: Record<ActionKind, number> = {
  semer: 0.09, //       ~8,7 jours pour emblaver les 96 ha
  fertiliser: 0.03, //  ~2,9 jours
  irriguer: 0.02, //    ~1,9 jour
  fongicide: 0.03,
  insecticide: 0.03,
  /**
   * La moisson, ~21 jours pour 96 ha : le chantier qui sature la fenêtre.
   *
   * Une moissonneuse de six mètres avale dix à quatorze hectares par jour, mais
   * l'exploitant est seul : il coupe, il vide, il transporte, il surveille le
   * séchoir. Le rythme réel d'un chantier à une personne tourne autour de
   * quatre hectares et demi par jour ouvrable — et c'est ce chiffre, pas le
   * débit de la machine, qui décide si la récolte rentre avant l'orage.
   */
  recolter: 0.22,
  // Souscrire un contrat se fait au téléphone : aucun chantier.
  assurer: 0,
}

/** Vitesse de vent au-delà de laquelle la pulvérisation est proscrite, km/h. */
export const SPRAY_WIND_LIMIT = 55

export interface Workload {
  /** Jours ouvrables offerts par le tour. */
  readonly available: number
  /** Jours de la période perdus pour cause d'intempéries. */
  readonly lost: number
  /** La pulvérisation est-elle possible ce tour-ci ? */
  readonly canSpray: boolean
  /** Explication courte, affichée dans l'interface. */
  readonly note: string
}

/**
 * Jours réellement travaillables sur la période.
 *
 * Un jour de pluie ne coûte pas qu'une journée : le sol reste non portant
 * ensuite. On retient donc un coefficient supérieur à 1 par jour de pluie.
 */
export function workloadFor(turn: number, weather: Weather): Workload {
  const period = periodAt(turn)
  const total = period.days

  // Ressuyage : chaque jour de pluie immobilise environ 1,3 jour de chantier.
  const rainLoss = Math.min(total * 0.85, weather.rainDays * 1.3)

  // Sol gelé ou détrempé : on ne travaille pas non plus.
  const frostLoss = weather.tempMin < -3 ? Math.min(4, total * 0.25) : 0

  const lost = Math.min(total - 1, rainLoss + frostLoss)
  const available = clamp(total - lost, 1, total)

  const canSpray = weather.windMaxKmh <= SPRAY_WIND_LIMIT

  let note: string
  if (available >= total * 0.8) note = 'Conditions de chantier favorables.'
  else if (available >= total * 0.45) note = 'Le sol est parfois non portant : les chantiers avancent moins vite.'
  else note = 'Très peu de jours travaillables : il faudra choisir les parcelles.'

  return { available: Math.round(available * 10) / 10, lost: Math.round(lost * 10) / 10, canSpray, note }
}

/** Jours de chantier nécessaires pour une intervention sur une surface donnée. */
export function daysNeeded(kind: ActionKind, areaHa: number, lodged = false): number {
  const base = DAYS_PER_HECTARE[kind] * areaHa
  // Une culture versée se moissonne bien plus lentement : la barre de coupe
  // doit descendre et la machine avance au ralenti.
  const factor = kind === 'recolter' && lodged ? 1.45 : 1
  return Math.round(base * factor * 10) / 10
}
