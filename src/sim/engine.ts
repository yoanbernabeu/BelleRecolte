/**
 * Moteur de simulation.
 *
 * TypeScript pur, aucune dépendance au rendu : on peut le faire tourner en test
 * sans navigateur. Chaque tour applique les décisions du joueur, puis déroule
 * dans l'ordre le bilan hydrique, le cumul de degrés-jours, les stress
 * climatiques, la pression sanitaire et enfin la récolte.
 *
 * Le rendement final n'est pas tiré au sort : c'est le produit de facteurs qui
 * se sont construits tour après tour. Une mauvaise année se voit venir.
 */

import { labelOfTurn, PERIODS, periodAt, TURNS_PER_CAMPAIGN } from './calendar'
import { getCrop, sowableAt, sowingQuality, type Crop, type CropId } from './crops'
import {
  economicsOf,
  establishmentCostPerHa,
  ETA_CHANTIERS_PER_TURN,
  ETA_DAYS_SHARE,
  ETA_HARVEST_COST_PER_HA,
  IRRIGATION_PASS_COST_PER_HA,
  IRRIGATION_PASS_MM,
  NITROGEN_SPLIT_COST_PER_HA,
  OVERDRAFT_LIMIT,
  OVERDRAFT_RATE_PER_TURN,
  rollPrice,
  STARTING_BUDGET,
  STRUCTURE_COST_PER_HA,
} from './economics'
import { PARCELS, parcelDefinition, TOTAL_AREA_HA, type ParcelDefinition } from './farm'
import { rollHazards, type HazardId } from './hazards'
import {
  freshStocks,
  INITIAL_ORDER_COST,
  inputDefinition,
  type InputId,
  type InputStocks,
  type PendingDelivery,
} from './inputs'
import { indemnityFor, premiumFor, SUBSCRIPTION_WINDOW_TURNS } from './insurance'
import { daysBetween, rulesFor, turnAfterDays } from './regulation'
import { daysNeeded, workloadFor, type Workload } from './workdays'
import { clamp, clamp01, createRng, hashSeed, lerp, type Rng } from './rng'
import { getSoil } from './soils'
import {
  buildForecast,
  generateCampaignWeather,
  normalRainFor,
  rollYearCharacter,
  type Forecast,
  type Weather,
  type YearCharacter,
} from './weather'

export type GrowthStage =
  | 'vide'
  | 'seme'
  | 'levee'
  | 'croissance'
  | 'floraison'
  | 'remplissage'
  | 'mature'
  | 'recolte'

const STAGE_THRESHOLDS: ReadonlyArray<readonly [GrowthStage, number]> = [
  ['seme', 0],
  ['levee', 0.06],
  ['croissance', 0.2],
  ['floraison', 0.55],
  ['remplissage', 0.7],
  ['mature', 1],
]

/**
 * Formulations affichées au passage d'un stade. Elles ne nomment pas la culture :
 * la carte de parcelle l'affiche déjà, et s'en passer évite les accords de genre
 * et les élisions (« le orge », « semis de orge ») qui sonnent faux.
 */
const STAGE_ANNOUNCEMENTS: Partial<Record<GrowthStage, string>> = {
  levee: 'la culture a levé',
  croissance: 'en pleine croissance',
  floraison: 'entrée en floraison',
  remplissage: 'début du remplissage',
  mature: 'à maturité, la récolte peut se faire',
}

/** « de » devient « d' » devant une voyelle. */
function withElision(name: string): string {
  return /^[aeiouâéèêîôùûyh]/i.test(name) ? `d'${name}` : `de ${name}`
}

function stageFor(progress: number): GrowthStage {
  let stage: GrowthStage = 'seme'
  for (const [name, threshold] of STAGE_THRESHOLDS) {
    if (progress >= threshold) stage = name
  }
  return stage
}

/** Index du coefficient cultural correspondant au stade. */
function coefficientIndex(stage: GrowthStage): 0 | 1 | 2 | 3 | 4 {
  switch (stage) {
    case 'seme':
    case 'levee':
      return 0
    case 'croissance':
      return 1
    case 'floraison':
      return 2
    case 'remplissage':
      return 3
    default:
      return 4
  }
}

export interface ParcelState {
  readonly id: number
  crop: CropId | null
  sownTurn: number | null
  /** Degrés-jours cumulés depuis le semis. */
  gdd: number
  stage: GrowthStage
  /** Eau disponible dans le sol, mm. */
  soilWaterMm: number
  /** Azote disponible, unités N/ha. */
  nitrogenUnits: number
  /** Nombre d'apports d'azote déjà réalisés. */
  nitrogenSplitsDone: number
  /** Somme des apports pondérée par leur justesse de date, 0→nitrogenSplits. */
  nitrogenScore: number
  /** Santé du couvert, 0→1. Les dégâts s'y accumulent et ne se rattrapent pas. */
  vigor: number
  /** Pression maladie latente, 0→1. */
  diseasePressure: number
  /** Pression ravageurs latente, 0→1. */
  pestPressure: number
  /**
   * Déficit hydrique cumulé, pondéré par la sensibilité du stade, et poids
   * total correspondant. On en tire une moyenne et non une somme : sinon un blé
   * qui passe quatorze tours au champ serait mécaniquement plus pénalisé qu'un
   * maïs qui n'en passe que huit, ce qui n'a aucun sens agronomique.
   */
  waterStressSum: number
  waterStressWeight: number
  /** Excès thermique cumulé pendant le remplissage, et nombre de tours concernés. */
  heatStressSum: number
  heatStressTurns: number
  lodged: boolean
  /**
   * Drapeaux d'alerte déjà signalée. Sans eux, une pression qui reste au-dessus
   * du seuil réémet le même message à chaque tour et noie le journal.
   */
  diseaseWarned: boolean
  pestWarned: boolean
  /** Dernier stade annoncé, pour ne signaler que les changements. */
  lastAnnouncedStage: GrowthStage
  /** Qualité de la date de semis retenue, 0→1. */
  sowingQuality: number
  fungicidePasses: number
  insecticidePasses: number
  irrigationPasses: number
  /** Tour du dernier traitement, pour l'intervalle minimal entre passages. */
  lastFungicideTurn: number | null
  lastInsecticideTurn: number | null
  /**
   * Tour avant lequel la récolte est interdite au titre du délai avant récolte.
   * Traiter tard, c'est repousser sa moisson — et s'exposer aux orages.
   */
  harvestBlockedUntil: number
  /** Nombre de tours consécutifs de sécheresse sévère subis. */
  droughtStreak: number
  /** La parcelle a été retournée : culture détruite, aucune récolte possible. */
  lost: boolean
  harvested: boolean
  /** Rendement récolté, en tonnes sur la parcelle entière. */
  harvestedTonnes: number
  /** Recette encaissée, en euros. */
  revenue: number
  /** La récolte a-t-elle été confiée à une entreprise de travaux ? */
  harvestedByContractor: boolean
  /** Contrat d'assurance récolte souscrit sur cette parcelle. */
  insured: boolean
  /** Prime versée, en euros. */
  insurancePremium: number
  /** Indemnité perçue en fin de campagne, en euros. */
  insurancePayout: number
  /** Aléas biologiques déjà subis, pour ne pas répéter le même message. */
  hazardsSuffered: HazardId[]
}

export interface LogEntry {
  readonly turn: number
  readonly kind: 'info' | 'warning' | 'damage' | 'success'
  readonly parcelId: number | null
  readonly message: string
}

export type ActionKind =
  | 'semer'
  | 'fertiliser'
  | 'irriguer'
  | 'fongicide'
  | 'insecticide'
  | 'recolter'
  | 'assurer'

export interface Action {
  readonly kind: ActionKind
  readonly parcelId: number
  readonly crop?: CropId
  /** Récolte confiée à une entreprise de travaux plutôt qu'assurée en régie. */
  readonly hired?: boolean
}

export interface ActionCheck {
  readonly allowed: boolean
  readonly cost: number
  readonly reason?: string
  /** Intrant consommé par l'action, quand il y en a un. */
  readonly input?: { readonly id: InputId; readonly quantity: number }
}

export interface ParcelAdvice {
  readonly action: ActionKind
  readonly label: string
  readonly urgency: 'urgent' | 'conseille' | 'possible'
  readonly why: string
}

export interface ParcelDanger {
  readonly parcelId: number
  /**
   * `sinistre` désigne un fait accompli — la grêle est passée, les sangliers
   * sont entrés — par opposition aux deux autres, qui appellent une décision.
   * La distinction compte à l'affichage : on n'invite pas à agir sur ce qui
   * est déjà arrivé, on informe.
   */
  readonly severity: 'alerte' | 'critique' | 'sinistre'
  readonly title: string
  readonly message: string
}

export interface CampaignResult {
  readonly totalTonnes: number
  readonly totalRevenue: number
  readonly totalSpent: number
  readonly margin: number
  /** Détail de ce qui a été dépensé, pour que la perte soit explicable. */
  readonly operatingCost: number
  readonly structureCost: number
  readonly financialCost: number
  readonly contractorCost: number
  readonly insuranceCost: number
  readonly insurancePayout: number
  readonly yearName: string
  readonly yearDescription: string
}

export class Campaign {
  readonly seedCode: string
  readonly character: YearCharacter
  readonly weather: readonly Weather[]
  readonly parcels: ParcelState[]

  private readonly rng: Rng
  private readonly priceRolls: Map<CropId, number> = new Map()
  private readonly forecastRng: Rng

  turn = 0
  budget = STARTING_BUDGET
  spent = 0
  /** Jours de chantier déjà consommés sur le tour en cours. */
  daysUsed = 0
  readonly log: LogEntry[] = []
  finished = false

  /** Stocks d'intrants en hangar, et ce qui est en route. */
  readonly stocks: InputStocks = freshStocks()
  private readonly deliveries: PendingDelivery[] = []

  /** Chantiers d'entreprise déjà engagés sur le tour en cours. */
  contractorJobsUsed = 0

  /** Ventilation des dépenses, tenue à jour au fil de la campagne. */
  readonly spending = {
    /** Semences, engrais, produits, irrigation, réapprovisionnements. */
    operating: 0,
    /** Fermage, mécanisation, assurances de l'exploitation, cotisations. */
    structure: 0,
    /** Agios du découvert. */
    financial: 0,
    /** Factures d'entreprise de travaux agricoles. */
    contractor: 0,
    /** Primes d'assurance récolte. */
    insurance: 0,
  }
  /** Indemnités d'assurance encaissées. */
  insurancePayout = 0

  constructor(seedCode: string) {
    this.seedCode = seedCode.trim().toUpperCase()
    const seed = hashSeed(this.seedCode)
    this.rng = createRng(seed)
    this.forecastRng = createRng(seed ^ 0x5bf03635)

    this.character = rollYearCharacter(this.rng)
    this.weather = generateCampaignWeather(this.character, this.rng)

    this.parcels = PARCELS.map((parcel) => this.freshParcel(parcel))

    // La commande d'été est déjà passée : le hangar est plein, le compte est
    // entamé d'autant. C'est la première contrainte de la campagne, et elle est
    // posée avant que le joueur n'ait décidé quoi que ce soit.
    this.budget -= INITIAL_ORDER_COST
    this.spent += INITIAL_ORDER_COST
    this.spending.operating += INITIAL_ORDER_COST

    this.push('info', null, `Campagne ${this.seedCode}. Les sols sont préparés, à vous de jouer.`)
    this.push(
      'info',
      null,
      `Commande d’été réglée : ${INITIAL_ORDER_COST.toLocaleString('fr-FR')} € d’engrais et de produits en hangar.`,
    )
  }

  private freshParcel(definition: ParcelDefinition): ParcelState {
    const soil = getSoil(definition.soil)
    return {
      id: definition.id,
      crop: null,
      sownTurn: null,
      gdd: 0,
      stage: 'vide',
      // On démarre en août : les sols sortent de moisson, à moitié pleins.
      soilWaterMm: soil.waterCapacityMm * 0.45,
      nitrogenUnits: soil.nitrogenSupply,
      nitrogenSplitsDone: 0,
      nitrogenScore: 0,
      vigor: 1,
      diseasePressure: 0,
      pestPressure: 0,
      waterStressSum: 0,
      waterStressWeight: 0,
      heatStressSum: 0,
      heatStressTurns: 0,
      lodged: false,
      diseaseWarned: false,
      pestWarned: false,
      lastAnnouncedStage: 'vide',
      sowingQuality: 0,
      fungicidePasses: 0,
      insecticidePasses: 0,
      irrigationPasses: 0,
      lastFungicideTurn: null,
      lastInsecticideTurn: null,
      harvestBlockedUntil: 0,
      droughtStreak: 0,
      lost: false,
      harvested: false,
      harvestedTonnes: 0,
      revenue: 0,
      harvestedByContractor: false,
      insured: false,
      insurancePremium: 0,
      insurancePayout: 0,
      hazardsSuffered: [],
    }
  }

  private push(kind: LogEntry['kind'], parcelId: number | null, message: string): void {
    this.log.push({ turn: this.turn, kind, parcelId, message })
  }

  parcel(id: number): ParcelState {
    const state = this.parcels[id]
    if (!state) throw new Error(`Parcelle inconnue : ${id}`)
    return state
  }

  /** Capital de jours ouvrables du tour, déduit de la météo. */
  workload(): Workload {
    return workloadFor(this.turn, this.currentWeather())
  }

  /** Jours de chantier encore disponibles ce tour-ci. */
  get daysLeft(): number {
    return Math.round((this.workload().available - this.daysUsed) * 10) / 10
  }

  /** Jours qu'exigerait cette intervention, sans se prononcer sur sa légalité. */
  daysFor(action: Action): number {
    const definition = parcelDefinition(action.parcelId)
    const state = this.parcel(action.parcelId)
    return this.daysForKind(action.kind, definition.areaHa, state.lodged, action.hired === true)
  }

  currentWeather(): Weather {
    const weather = this.weather[Math.min(this.turn, TURNS_PER_CAMPAIGN - 1)]
    if (!weather) throw new Error('Météo manquante')
    return weather
  }

  /** Prévisions pour les trois prochains tours, de fiabilité décroissante. */
  forecasts(): readonly Forecast[] {
    const out: Forecast[] = []
    for (let horizon = 0; horizon < 3; horizon++) {
      const target = this.turn + 1 + horizon
      if (target >= TURNS_PER_CAMPAIGN) break
      const weather = this.weather[target]
      if (!weather) break
      out.push(buildForecast(weather, horizon, this.forecastRng, normalRainFor(target)))
    }
    return out
  }

  // ------------------------------------------------------------ actions

  check(action: Action): ActionCheck {
    const state = this.parcel(action.parcelId)
    const definition = parcelDefinition(action.parcelId)
    const area = definition.areaHa

    switch (action.kind) {
      case 'semer': {
        if (state.crop) return { allowed: false, cost: 0, reason: 'Parcelle déjà emblavée' }
        if (!action.crop) return { allowed: false, cost: 0, reason: 'Aucune culture choisie' }
        const crop = getCrop(action.crop)
        if (this.turn < crop.sowing.earliest || this.turn > crop.sowing.latest) {
          return { allowed: false, cost: 0, reason: 'Hors de la fenêtre de semis' }
        }
        // Précédent cultural : le motif le plus fréquent de refus, et le plus
        // facile à comprendre quand on l'explique.
        const back = definition.history.indexOf(action.crop)
        if (back !== -1 && back < crop.returnIntervalYears - 1) {
          const wait = crop.returnIntervalYears - 1 - back
          return {
            allowed: false,
            cost: 0,
            reason:
              `Précédent ${crop.name.toLowerCase()} il y a ${back + 1} an${back > 0 ? 's' : ''} : ` +
              `retour possible dans ${wait} an${wait > 1 ? 's' : ''} (délai de ${crop.returnIntervalYears} ans)`,
          }
        }
        if (this.areaAlreadySown(crop.id) + area > crop.maxShare * TOTAL_AREA_HA + 0.01) {
          const already = Math.round(this.areaAlreadySown(crop.id) * 10) / 10
          return {
            allowed: false,
            cost: 0,
            reason:
              `Assolement : déjà ${already} ha en ${crop.shortName.toLowerCase()}, ` +
              `le plafond est de ${Math.round(crop.maxShare * TOTAL_AREA_HA)} ha (${Math.round(crop.maxShare * 100)} % de la surface)`,
          }
        }
        const chantier = this.workable('semer', action.parcelId)
        if (chantier) return chantier
        const cost = establishmentCostPerHa(action.crop) * area
        return this.affordable(cost)
      }
      case 'fertiliser': {
        const crop = this.requireCrop(state)
        if (!crop) return { allowed: false, cost: 0, reason: 'Parcelle vide' }
        if (state.nitrogenSplitsDone >= crop.nitrogenSplits) {
          return { allowed: false, cost: 0, reason: 'Programme azoté déjà complet' }
        }
        const units = (crop.nitrogenUnits / crop.nitrogenSplits) * area
        const stock = this.inputCheck('azote', units)
        if (stock) return stock
        const chantier = this.workable('fertiliser', action.parcelId)
        if (chantier) return chantier
        // L'engrais lui-même sort du stock : ne reste que l'épandage à payer.
        return this.affordable(NITROGEN_SPLIT_COST_PER_HA * area, {
          id: 'azote',
          quantity: units,
        })
      }
      case 'irriguer': {
        const crop = this.requireCrop(state)
        if (!crop) return { allowed: false, cost: 0, reason: 'Parcelle vide' }
        if (!definition.irrigable) {
          return { allowed: false, cost: 0, reason: 'Parcelle non desservie par le réseau' }
        }
        const chantier = this.workable('irriguer', action.parcelId)
        if (chantier) return chantier
        return this.affordable(IRRIGATION_PASS_COST_PER_HA * area)
      }
      case 'fongicide': {
        const crop = this.requireCrop(state)
        if (!crop) return { allowed: false, cost: 0, reason: 'Parcelle vide' }
        const { costs, fungicidePasses } = economicsOf(crop.id)
        if (fungicidePasses === 0) {
          return { allowed: false, cost: 0, reason: 'Pas de programme fongicide sur cette culture' }
        }
        // On tolère deux passages de plus que l'itinéraire de référence : l'ITB
        // prévoit jusqu'à quatre interventions sur betterave (T1 à T4).
        if (state.fungicidePasses >= fungicidePasses + 2) {
          return { allowed: false, cost: 0, reason: 'Nombre maximal d’applications atteint' }
        }
        const gap = this.intervalCheck(state.lastFungicideTurn, crop.id)
        if (gap) return gap
        const stock = this.inputCheck('fongicide', area)
        if (stock) return stock
        const chantier = this.workable('fongicide', action.parcelId)
        if (chantier) return chantier
        // Le produit sort du stock ; la facture ne porte que le passage.
        return this.affordable(costs.fungicidePass * area * 0.25, {
          id: 'fongicide',
          quantity: area,
        })
      }
      case 'insecticide': {
        const crop = this.requireCrop(state)
        if (!crop) return { allowed: false, cost: 0, reason: 'Parcelle vide' }
        const gap = this.intervalCheck(state.lastInsecticideTurn, crop.id)
        if (gap) return gap
        const stock = this.inputCheck('insecticide', area)
        if (stock) return stock
        const chantier = this.workable('insecticide', action.parcelId)
        if (chantier) return chantier
        const { costs } = economicsOf(crop.id)
        return this.affordable(costs.insecticidePass * area * 0.25, {
          id: 'insecticide',
          quantity: area,
        })
      }
      case 'recolter': {
        if (state.lost) return { allowed: false, cost: 0, reason: 'Culture perdue' }
        const crop = this.requireCrop(state)
        if (!crop) return { allowed: false, cost: 0, reason: 'Parcelle vide' }
        if (this.turn < crop.harvest.earliest) {
          return { allowed: false, cost: 0, reason: 'La culture n’est pas mûre' }
        }
        if (this.turn < state.harvestBlockedUntil) {
          const reste = state.harvestBlockedUntil - this.turn
          return {
            allowed: false,
            cost: 0,
            reason: `Délai avant récolte : traitée trop récemment, encore ${reste} tour${reste > 1 ? 's' : ''} d’attente`,
          }
        }
        if (action.hired && this.contractorJobsUsed >= ETA_CHANTIERS_PER_TURN) {
          return {
            allowed: false,
            cost: 0,
            reason: `L’entreprise est prise : ${ETA_CHANTIERS_PER_TURN} chantiers au maximum par quinzaine`,
          }
        }
        const chantier = this.workable('recolter', action.parcelId, action.hired === true)
        if (chantier) return chantier
        const { costs } = economicsOf(crop.id)
        const contractor = action.hired ? ETA_HARVEST_COST_PER_HA[crop.id] : 0
        return this.affordable((costs.harvestExtra + contractor) * area)
      }
      case 'assurer': {
        if (state.insured) return { allowed: false, cost: 0, reason: 'Parcelle déjà assurée' }
        const crop = this.requireCrop(state)
        if (!crop) return { allowed: false, cost: 0, reason: 'Parcelle vide' }
        if (state.sownTurn === null) return { allowed: false, cost: 0, reason: 'Parcelle vide' }
        if (this.turn > state.sownTurn + SUBSCRIPTION_WINDOW_TURNS) {
          return {
            allowed: false,
            cost: 0,
            reason:
              `Fenêtre de souscription close : l’assureur ne couvre une culture que dans les ` +
              `${SUBSCRIPTION_WINDOW_TURNS} tours qui suivent son semis`,
          }
        }
        return this.affordable(premiumFor(crop.id, area))
      }
      default:
        return { allowed: false, cost: 0, reason: 'Action inconnue' }
    }
  }

  /** Refuse l'action si le hangar est vide, en disant ce qu'il manque. */
  private inputCheck(id: InputId, quantity: number): ActionCheck | null {
    const stock = this.stocks[id]
    if (stock.available >= quantity - 0.001) return null

    const definition = inputDefinition(id)
    const missing = Math.ceil(quantity - stock.available)
    const enRoute = stock.incoming > 0 ? `, ${Math.round(stock.incoming)} ${definition.unit} en route` : ''
    return {
      allowed: false,
      cost: 0,
      reason:
        `Stock de ${definition.name.toLowerCase()} insuffisant : il manque ` +
        `${missing} ${definition.unit}${enRoute}`,
    }
  }

  /** Surface déjà emblavée en cette culture sur la campagne, en hectares. */
  areaAlreadySown(crop: CropId): number {
    return this.parcels.reduce(
      (sum, state) => (state.crop === crop ? sum + parcelDefinition(state.id).areaHa : sum),
      0,
    )
  }

  /** Refuse un traitement trop rapproché du précédent (règle E-Phy). */
  private intervalCheck(lastTurn: number | null, crop: CropId): ActionCheck | null {
    if (lastTurn === null) return null
    const rules = rulesFor(crop)
    const elapsed = daysBetween(lastTurn, this.turn)
    if (elapsed >= rules.minIntervalDays) return null
    return {
      allowed: false,
      cost: 0,
      reason: `Intervalle minimal de ${rules.minIntervalDays} jours entre deux passages non respecté`,
    }
  }

  private requireCrop(state: ParcelState): Crop | null {
    if (!state.crop || state.harvested) return null
    return getCrop(state.crop)
  }

  /**
   * La dépense passe-t-elle ?
   *
   * Une campagne se finance à découvert : les charges partent en août, les
   * recettes rentrent onze mois plus tard. Ce n'est donc pas la trésorerie qui
   * borne la décision, c'est l'autorisation bancaire — et quand elle est
   * atteinte, c'est la banque qui refuse, pas le jeu.
   */
  private affordable(
    cost: number,
    input?: { readonly id: InputId; readonly quantity: number },
  ): ActionCheck {
    const rounded = Math.round(cost)
    if (this.budget - rounded < -OVERDRAFT_LIMIT) {
      return {
        allowed: false,
        cost: rounded,
        reason: `Découvert autorisé dépassé (plafond ${OVERDRAFT_LIMIT.toLocaleString('fr-FR')} €)`,
      }
    }
    return input ? { allowed: true, cost: rounded, input } : { allowed: true, cost: rounded }
  }

  /** Découvert courant, en euros positifs ; 0 si la trésorerie est créditrice. */
  get overdraft(): number {
    return Math.max(0, -this.budget)
  }

  /** Ce qu'il reste à engager avant que la banque ne dise non. */
  get creditLeft(): number {
    return Math.round(this.budget + OVERDRAFT_LIMIT)
  }

  /**
   * Conditions de chantier : le temps disponible, et la faisabilité matérielle.
   * On ne pulvérise pas par grand vent, et on n'entre pas dans un champ gorgé
   * d'eau — ce sont des impossibilités, pas des arbitrages.
   */
  private workable(kind: ActionKind, parcelId: number, hired = false): ActionCheck | null {
    const workload = this.workload()
    const definition = parcelDefinition(parcelId)
    const state = this.parcel(parcelId)

    if ((kind === 'fongicide' || kind === 'insecticide') && !workload.canSpray) {
      return {
        allowed: false,
        cost: 0,
        reason: `Vent trop fort pour pulvériser (${Math.round(this.currentWeather().windMaxKmh)} km/h)`,
      }
    }

    // Portance : on n'entre pas dans un champ détrempé. Mais un sol plein n'est
    // pas un sol détrempé — il faut aussi qu'il pleuve. Le seul niveau de
    // remplissage suffisait à interdire tout un printemps de semis derrière un
    // hiver arrosé, ce qui n'arrive pas dans un vrai champ : entre deux averses,
    // on entre.
    if (kind === 'semer' || kind === 'recolter') {
      const soil = getSoil(definition.soil)
      const weather = this.currentWeather()
      const saturated = state.soilWaterMm > soil.waterCapacityMm * 0.94
      const wetSpell = weather.rainDays >= periodAt(this.turn).days * 0.5
      if (saturated && wetSpell) {
        return { allowed: false, cost: 0, reason: 'Parcelle non portante : le sol est gorgé d’eau' }
      }
    }

    const needed = this.daysForKind(kind, definition.areaHa, state.lodged, hired)
    if (needed > this.daysLeft + 0.05) {
      return {
        allowed: false,
        cost: 0,
        reason: hired
          ? `Même avec l’entreprise, il faut ${needed} jours et il n’en reste que ${Math.max(0, this.daysLeft)}`
          : `Chantier de ${needed} jours, il n’en reste que ${Math.max(0, this.daysLeft)}`,
      }
    }
    return null
  }

  /**
   * Jours de chantier d'une intervention.
   *
   * L'entreprise arrive avec sa machine et son chauffeur : il ne reste à
   * l'exploitant que la logistique — les bennes, le stockage, la surveillance.
   * C'est précisément ce qu'on achète en l'appelant.
   */
  private daysForKind(kind: ActionKind, areaHa: number, lodged: boolean, hired: boolean): number {
    if (kind === 'assurer') return 0
    const base = daysNeeded(kind, areaHa, lodged)
    if (!hired) return base
    return Math.round(base * ETA_DAYS_SHARE * 10) / 10
  }

  apply(action: Action): boolean {
    const verdict = this.check(action)
    if (!verdict.allowed) return false

    const state = this.parcel(action.parcelId)
    const definition = parcelDefinition(action.parcelId)
    this.budget -= verdict.cost
    this.spent += verdict.cost
    this.daysUsed = Math.round((this.daysUsed + this.daysFor(action)) * 10) / 10

    if (verdict.input) {
      this.stocks[verdict.input.id].available -= verdict.input.quantity
    }
    if (action.kind === 'assurer') this.spending.insurance += verdict.cost
    else if (action.kind === 'recolter' && action.hired) {
      this.contractorJobsUsed += 1
      const crop = getCrop(state.crop as CropId)
      const contractor = Math.round(ETA_HARVEST_COST_PER_HA[crop.id] * definition.areaHa)
      this.spending.contractor += contractor
      this.spending.operating += verdict.cost - contractor
    } else this.spending.operating += verdict.cost

    switch (action.kind) {
      case 'semer': {
        if (!action.crop) return false
        const crop = getCrop(action.crop)
        state.crop = action.crop
        state.sownTurn = this.turn
        state.stage = 'seme'
        state.sowingQuality = sowingQuality(crop, this.turn)
        this.push(
          'info',
          state.id,
          `${definition.name} : semis ${withElision(crop.name.toLowerCase())}${
            state.sowingQuality < 0.85 ? ', un peu hors de la fenêtre optimale' : ''
          }.`,
        )
        return true
      }
      case 'fertiliser': {
        const crop = this.requireCrop(state)
        if (!crop) return false
        const split = crop.nitrogenSchedule[state.nitrogenSplitsDone]
        // Hors de la fenêtre, la plante n'est pas au stade où elle absorbe :
        // l'engrais est payé plein pot mais ne rend que partiellement.
        const wellTimed = split ? this.turn >= split.from && this.turn <= split.to : false
        state.nitrogenSplitsDone += 1
        state.nitrogenScore += wellTimed ? 1 : 0.55
        state.nitrogenUnits += crop.nitrogenUnits / crop.nitrogenSplits
        if (!wellTimed && split) {
          this.push(
            'warning',
            state.id,
            `${definition.name} : apport d’azote hors fenêtre (${split.label.toLowerCase()}), efficacité réduite.`,
          )
        }
        return true
      }
      case 'irriguer': {
        const soil = getSoil(definition.soil)
        state.soilWaterMm = Math.min(soil.waterCapacityMm, state.soilWaterMm + IRRIGATION_PASS_MM)
        state.irrigationPasses += 1
        return true
      }
      case 'fongicide': {
        const crop = this.requireCrop(state)
        if (!crop) return false
        state.fungicidePasses += 1
        state.lastFungicideTurn = this.turn
        state.diseasePressure = Math.max(0, state.diseasePressure - 0.7)
        state.diseaseWarned = false
        this.applyPreHarvestDelay(state, rulesFor(crop.id).fungicidePreHarvestDays, definition)
        return true
      }
      case 'insecticide': {
        const crop = this.requireCrop(state)
        if (!crop) return false
        state.insecticidePasses += 1
        state.lastInsecticideTurn = this.turn
        state.pestPressure = Math.max(0, state.pestPressure - 0.7)
        state.pestWarned = false
        this.applyPreHarvestDelay(state, rulesFor(crop.id).insecticidePreHarvestDays, definition)
        return true
      }
      case 'recolter':
        state.harvestedByContractor = action.hired === true
        this.harvest(state, definition)
        return true
      case 'assurer': {
        state.insured = true
        state.insurancePremium = verdict.cost
        this.push(
          'info',
          state.id,
          `${definition.name} : récolte assurée pour ${verdict.cost.toLocaleString('fr-FR')} € de prime.`,
        )
        return true
      }
      default:
        return false
    }
  }

  /**
   * Commande un lot d'intrant. Il n'arrive pas tout de suite : c'est ce délai,
   * plus que le prix, qui punit le joueur qui n'a rien anticipé.
   */
  orderInput(id: InputId): boolean {
    const definition = inputDefinition(id)
    const verdict = this.affordable(definition.restockPrice)
    if (!verdict.allowed) return false

    this.budget -= verdict.cost
    this.spent += verdict.cost
    this.spending.operating += verdict.cost

    this.stocks[id].incoming += definition.restockLot
    this.deliveries.push({
      input: id,
      quantity: definition.restockLot,
      arrivesAtTurn: this.turn + definition.leadTimeTurns,
    })

    this.push(
      'info',
      null,
      `${definition.restockLot} ${definition.unit} de ${definition.name.toLowerCase()} commandés, ` +
        `livraison ${labelOfTurn(this.turn + definition.leadTimeTurns)}.`,
    )
    return true
  }

  /** Le lot est-il commandable, et à quel prix ? */
  checkOrder(id: InputId): ActionCheck {
    return this.affordable(inputDefinition(id).restockPrice)
  }

  /**
   * Pose le délai avant récolte consécutif à un traitement, et prévient le
   * joueur quand ce délai déborde effectivement sur sa fenêtre de moisson.
   */
  private applyPreHarvestDelay(
    state: ParcelState,
    days: number,
    definition: ParcelDefinition,
  ): void {
    const blockedUntil = turnAfterDays(this.turn, days)
    if (blockedUntil <= state.harvestBlockedUntil) return
    state.harvestBlockedUntil = blockedUntil

    const crop = getCrop(state.crop as CropId)
    if (blockedUntil > crop.harvest.bestFrom) {
      this.push(
        'warning',
        state.id,
        `${definition.name} : délai avant récolte de ${days} jours, la moisson ne pourra pas se faire avant ${labelOfTurn(blockedUntil)}.`,
      )
    }
  }

  // ------------------------------------------------------------ résolution

  /** Déroule le tour courant et avance d'une période. */
  advance(): void {
    if (this.finished) return

    const weather = this.currentWeather()
    const period = periodAt(this.turn)

    for (const state of this.parcels) {
      if (!state.crop || state.harvested) {
        this.updateFallow(state)
        continue
      }
      this.updateCrop(state, weather)
    }

    this.turn += 1
    this.daysUsed = 0
    this.contractorJobsUsed = 0
    this.settleFixedCosts()
    this.receiveDeliveries()

    if (this.turn >= TURNS_PER_CAMPAIGN) {
      this.closeCampaign()
      return
    }

    // Récolte forcée : au-delà de la fenêtre, la culture reste au champ et se perd.
    for (const state of this.parcels) {
      if (!state.crop || state.harvested) continue
      const crop = getCrop(state.crop)
      if (this.turn > crop.harvest.latest) {
        const definition = parcelDefinition(state.id)
        this.push(
          'damage',
          state.id,
          `${definition.name} : récolte non faite à temps, la parcelle est perdue.`,
        )
        state.harvested = true
        state.vigor = 0
      }
    }

    void period
  }

  /**
   * Charges qui tombent qu'on récolte ou non, plus les agios du découvert.
   *
   * C'est le poste que le joueur ne décide pas, et c'est pour cette raison
   * qu'il est prélevé automatiquement et annoncé : le fermage part que la
   * parcelle produise ou qu'elle soit retournée, et une campagne passée dans le
   * rouge se paie deux fois — une fois en intérêts, une fois en marge perdue.
   */
  private settleFixedCosts(): void {
    const perTurn = Math.round((STRUCTURE_COST_PER_HA * TOTAL_AREA_HA) / TURNS_PER_CAMPAIGN)
    this.budget -= perTurn
    this.spent += perTurn
    this.spending.structure += perTurn

    if (this.budget < 0) {
      const interest = Math.round(-this.budget * OVERDRAFT_RATE_PER_TURN)
      if (interest > 0) {
        this.budget -= interest
        this.spent += interest
        this.spending.financial += interest
      }
    }
  }

  /** Les lots commandés entrent en hangar au tour prévu. */
  private receiveDeliveries(): void {
    for (let i = this.deliveries.length - 1; i >= 0; i--) {
      const delivery = this.deliveries[i]
      if (!delivery || delivery.arrivesAtTurn > this.turn) continue
      const stock = this.stocks[delivery.input]
      stock.available += delivery.quantity
      stock.incoming = Math.max(0, stock.incoming - delivery.quantity)
      this.deliveries.splice(i, 1)

      const definition = inputDefinition(delivery.input)
      this.push(
        'info',
        null,
        `Livraison : ${delivery.quantity} ${definition.unit} de ${definition.name.toLowerCase()}.`,
      )
    }
  }

  /** Sur une parcelle nue, le sol se recharge et l'azote se minéralise. */
  private updateFallow(state: ParcelState): void {
    const definition = parcelDefinition(state.id)
    const soil = getSoil(definition.soil)
    const weather = this.currentWeather()
    const infiltration = weather.rainMm * clamp(1 / soil.drainage, 0.6, 1.2)
    const evaporation = weather.et0Mm * 0.32
    const filled = clamp(state.soilWaterMm + infiltration - evaporation, 0, soil.waterCapacityMm)

    // Ressuyage.
    //
    // Sans lui, un sol nu arrosé tout l'hiver reste collé à sa capacité jusqu'en
    // mai : l'évaporation seule ne suffit pas à le vider quand l'ET0 est basse.
    // La parcelle n'était alors jamais portante et tous les semis de printemps
    // devenaient impossibles — un blocage silencieux qui laissait la moitié de
    // l'exploitation en friche. Dans un vrai sol, l'excédent au-delà de la
    // réserve utile part en drainage profond en quelques jours.
    const drainThreshold = soil.waterCapacityMm * 0.9
    const excess = Math.max(0, filled - drainThreshold)
    state.soilWaterMm = filled - excess * clamp(soil.drainage * 0.45, 0.2, 0.75)
  }

  private updateCrop(state: ParcelState, weather: Weather): void {
    const definition = parcelDefinition(state.id)
    const soil = getSoil(definition.soil)
    const crop = getCrop(state.crop as CropId)
    const physiology = crop.physiology
    const period = periodAt(this.turn)

    // --- 1. degrés-jours et stade
    // Arvalis plafonne la température à 30 °C dans le cumul de degrés-jours du
    // maïs : au-delà, la plante n'accélère plus son développement.
    const cappedTemp = Math.min(weather.tempMean, 30)
    const effectiveTemp = Math.max(0, cappedTemp - physiology.baseTemp)
    state.gdd += effectiveTemp * period.days
    const progress = state.gdd / physiology.gddMaturity
    let stage = stageFor(progress)
    // Verrou de vernalisation : tant que la date n'y est pas, la culture reste
    // végétative même si elle a accumulé assez de chaleur.
    if (this.turn < physiology.reproductiveFrom && stage !== 'seme' && stage !== 'levee') {
      stage = 'croissance'
    }
    state.stage = stage

    // Les passages de stade sont l'information la plus utile du journal :
    // c'est ce qui dit au joueur qu'une fenêtre d'intervention s'ouvre ou se ferme.
    if (stage !== state.lastAnnouncedStage) {
      state.lastAnnouncedStage = stage
      const announcement = STAGE_ANNOUNCEMENTS[stage]
      if (announcement) {
        this.push('info', state.id, `${definition.name} : ${announcement}.`)
      }
    }

    // --- 2. bilan hydrique
    const kc = physiology.cropCoefficients[coefficientIndex(state.stage)] ?? 0.8
    const infiltration = weather.rainMm * clamp(1 / soil.drainage, 0.55, 1.25)
    const demand = weather.et0Mm * kc
    const available = state.soilWaterMm + infiltration
    const actualUse = Math.min(available, demand)
    state.soilWaterMm = clamp(available - actualUse, 0, soil.waterCapacityMm)

    // Ratio de satisfaction : c'est lui qui fait ou défait le rendement.
    const satisfaction = demand > 0 ? actualUse / demand : 1
    const stageWeight =
      state.stage === 'floraison' || state.stage === 'remplissage' ? 1 : state.stage === 'croissance' ? 0.55 : 0.2
    state.waterStressSum += (1 - satisfaction) * stageWeight
    state.waterStressWeight += stageWeight

    // Sécheresse sévère : sous 35 % de satisfaction, la plante ne perd plus
    // seulement du rendement, elle grille. Deux tours d'affilée en pleine
    // floraison suffisent à compromettre une parcelle.
    if (satisfaction < 0.35 && state.stage !== 'seme' && state.stage !== 'mature') {
      state.droughtStreak += 1
      const severity = (0.35 - satisfaction) / 0.35
      const burn = severity * stageWeight * 0.34 * (1 + state.droughtStreak * 0.45)
      state.vigor = clamp01(state.vigor - burn)
      if (burn > 0.05) {
        this.push(
          'damage',
          state.id,
          state.droughtStreak > 1
            ? `${definition.name} : la culture grille sur pied, ${state.droughtStreak}ᵉ tour sans eau.`
            : `${definition.name} : sécheresse marquée, la culture souffre.`,
        )
      }
    } else {
      state.droughtStreak = 0
    }

    // Excès d'eau : asphyxie racinaire sur sols lourds en hiver.
    if (state.soilWaterMm >= soil.waterCapacityMm * 0.98 && weather.rainMm > 55) {
      const drowning = soil.waterloggingRisk * 0.06
      state.vigor = clamp01(state.vigor - drowning)
      if (drowning > 0.02) {
        this.push('damage', state.id, `${definition.name} : excès d'eau, les racines étouffent.`)
      }
    }

    // --- 3. gel
    const reproductive =
      state.stage === 'floraison' || state.stage === 'remplissage' || state.stage === 'mature'
    const frostLimit = reproductive ? physiology.frostReproductive : physiology.frostVegetative
    if (weather.tempMin < frostLimit) {
      const severity = clamp01((frostLimit - weather.tempMin) / 6)
      // Un couvert bien implanté encaisse mieux : la vigueur amortit le choc.
      const damage = severity * (reproductive ? 0.42 : 0.28) * lerp(1.25, 0.75, state.vigor)
      state.vigor = clamp01(state.vigor - damage)
      if (damage > 0.03) {
        this.push(
          'damage',
          state.id,
          `${definition.name} : gel à ${weather.tempMin.toFixed(1)} °C sur ${crop.shortName.toLowerCase()}.`,
        )
      }
    }

    // --- 4. échaudage
    if (weather.tempMax > physiology.heatThreshold && (state.stage === 'floraison' || state.stage === 'remplissage')) {
      const excess = weather.tempMax - physiology.heatThreshold
      state.heatStressSum += excess
      state.heatStressTurns += 1
      if (excess > 5) {
        this.push(
          'damage',
          state.id,
          `${definition.name} : ${weather.tempMax.toFixed(0)} °C pendant le remplissage, le grain s'échaude.`,
        )
      }
    }

    // --- 5. maladies : elles se déclenchent sur l'humidité et la douceur
    const humid = clamp01(weather.rainDays / (period.days * 0.5))
    const mild = clamp01((weather.tempMean - 8) / 14)
    const growing = state.stage === 'croissance' || state.stage === 'floraison' || state.stage === 'remplissage'
    if (growing) {
      state.diseasePressure = clamp01(
        state.diseasePressure + humid * mild * physiology.diseaseSusceptibility * 0.45,
      )
      if (state.diseasePressure > 0.5) {
        const loss = (state.diseasePressure - 0.5) * 0.09
        state.vigor = clamp01(state.vigor - loss)
        if (state.diseasePressure > 0.72 && !state.diseaseWarned) {
          state.diseaseWarned = true
          this.push('warning', state.id, `${definition.name} : la maladie s'installe, il faudrait traiter.`)
        }
      }
      if (state.diseasePressure < 0.55) state.diseaseWarned = false
    }

    // --- 6. ravageurs : uniquement dans leurs fenêtres de vol
    const inPestWindow = physiology.pestWindows.some(([from, to]) => this.turn >= from && this.turn <= to)
    if (inPestWindow) {
      // Temps doux et sec : les vols sont plus importants.
      const dryWarm = clamp01((weather.tempMean - 6) / 16) * clamp01(1 - weather.rainMm / 60)
      state.pestPressure = clamp01(
        state.pestPressure + dryWarm * physiology.pestSusceptibility * 0.5,
      )
      if (state.pestPressure > 0.45) {
        const loss = (state.pestPressure - 0.45) * 0.2
        state.vigor = clamp01(state.vigor - loss)
        if (state.pestPressure > 0.65 && !state.pestWarned) {
          state.pestWarned = true
          this.push('warning', state.id, `${definition.name} : les ravageurs s'installent.`)
        }
      }
      if (state.pestPressure < 0.5) state.pestWarned = false
    } else {
      state.pestPressure = Math.max(0, state.pestPressure - 0.12)
      state.pestWarned = false
    }

    // --- 7. verse : un couvert lourd, un orage, et la parcelle se couche.
    // Le risque ne se déclenche que sur un vrai coup de vent — pas en continu.
    if (!state.lodged && (state.stage === 'remplissage' || state.stage === 'mature')) {
      const trigger = weather.events.find((e) => e.id === 'orage' || e.id === 'pluies-excessives')
      if (trigger) {
        const nitrogenExcess = clamp01(state.nitrogenUnits / Math.max(1, crop.nitrogenUnits) - 0.8)
        const risk =
          physiology.lodgingSusceptibility * trigger.intensity * 0.45 * (1 + nitrogenExcess * 0.6)
        if (this.rng() < risk) {
          state.lodged = true
          this.push('damage', state.id, `${definition.name} : la culture a versé sous l'orage.`)
        }
      }
    }

    // --- 8. grêle : brutale et sans recours, mais très localisée.
    // Une cellule orageuse ne couvre jamais toute l'exploitation — d'où le
    // tirage par parcelle. En revanche, là où elle passe, elle ne fait pas
    // dans la nuance : une grêle de plein été sur un blé en remplissage, c'est
    // la parcelle par terre, et c'est le sinistre qui justifie l'assurance.
    const hail = weather.events.find((e) => e.id === 'grele')
    if (hail && this.rng() < 0.28) {
      const exposed = state.stage === 'remplissage' || state.stage === 'mature' ? 1 : 0.6
      const damage = clamp01(0.2 + hail.intensity * 0.72) * exposed
      state.vigor = clamp01(state.vigor - damage)
      this.push(
        'damage',
        state.id,
        damage > 0.5
          ? `${definition.name} : la grêle a haché la parcelle.`
          : `${definition.name} : la grêle est passée sur la parcelle.`,
      )
    }

    // --- 8 bis. aléas biologiques : gibier, oiseaux, limaces.
    // Ils ne s'annoncent dans aucune prévision, et c'est l'exposition de la
    // parcelle — sa lisière de bois, sa culture, sa date de semis — qui décide.
    const strike = rollHazards(
      {
        crop: crop.id,
        stage: state.stage,
        turn: this.turn,
        turnsSinceSowing: state.sownTurn === null ? 0 : this.turn - state.sownTurn,
        nearWoods: definition.nearWoods,
        weather,
        soilMoisture: state.soilWaterMm / soil.waterCapacityMm,
        recentlyTreated:
          state.lastInsecticideTurn !== null && this.turn - state.lastInsecticideTurn <= 2,
      },
      this.rng,
    )
    if (strike) {
      state.vigor = clamp01(state.vigor - strike.damage)
      if (!state.hazardsSuffered.includes(strike.id)) state.hazardsSuffered.push(strike.id)
      this.push('damage', state.id, `${definition.name} : ${strike.message}.`)
    }

    // --- 9. consommation d'azote
    if (growing) {
      state.nitrogenUnits = Math.max(0, state.nitrogenUnits - crop.nitrogenUnits * 0.14)
    }

    // --- 10. retournement : sous ce seuil, le couvert ne se rattrape plus.
    // Dans la réalité on retourne la parcelle plutôt que de payer une récolte
    // qui ne couvrira pas ses frais.
    if (state.vigor < 0.15) {
      state.lost = true
      state.harvested = true
      this.push(
        'damage',
        state.id,
        `${definition.name} : la culture est perdue, la parcelle sera retournée.`,
      )
    }
  }

  // ------------------------------------------------------------ récolte

  /** Qualité du moment de récolte : trop tôt le grain n'est pas fait, trop tard il s'égrène. */
  private maturityFactor(state: ParcelState, crop: Crop): number {
    const progress = state.gdd / crop.physiology.gddMaturity
    if (progress < 0.82) return 0.55 + (progress / 0.82) * 0.3
    if (progress < 1) return 0.85 + ((progress - 0.82) / 0.18) * 0.15
    // Passé la maturité, chaque tour supplémentaire coûte.
    const overripe = Math.min(1, (progress - 1) / 0.25)
    return 1 - overripe * 0.22
  }

  private harvest(state: ParcelState, definition: ParcelDefinition): void {
    const crop = getCrop(state.crop as CropId)
    const soil = getSoil(definition.soil)

    // Déficit hydrique moyen sur le cycle, pondéré par la sensibilité du stade.
    const meanWaterDeficit =
      state.waterStressWeight > 0 ? state.waterStressSum / state.waterStressWeight : 0
    const waterFactor = clamp(1 - meanWaterDeficit * 1.15, 0.3, 1)

    // Échaudage : c'est l'intensité moyenne des coups de chaud qui compte,
    // amplifiée par leur nombre.
    const meanHeatExcess =
      state.heatStressTurns > 0 ? state.heatStressSum / state.heatStressTurns : 0
    const heatFactor = clamp(
      1 - meanHeatExcess * 0.022 * Math.min(state.heatStressTurns, 4),
      0.45,
      1,
    )
    const nitrogenFactor = clamp(
      0.55 + 0.45 * (state.nitrogenScore / Math.max(1, crop.nitrogenSplits)),
      0.55,
      1,
    )
    const maturity = this.maturityFactor(state, crop)
    const lodging = state.lodged ? 0.72 : 1

    // Le plafond agronomique reste le plafond : un bon sol aide à s'en approcher,
    // il ne permet pas de le dépasser.
    const yieldPerHa = Math.min(
      crop.potentialYield,
      crop.potentialYield *
        state.vigor *
        Math.max(state.sowingQuality, 0.35) *
        waterFactor *
        heatFactor *
        nitrogenFactor *
        maturity *
        soil.yieldFactor *
        lodging,
    )

    const tonnes = Math.max(0, yieldPerHa * definition.areaHa)

    // Prix : tiré une fois par culture pour toute la campagne, incliné par
    // l'indice de rendement — une mauvaise récolte se vend mieux.
    let roll = this.priceRolls.get(crop.id)
    if (roll === undefined) {
      roll = this.rng()
      this.priceRolls.set(crop.id, roll)
    }
    const yieldIndex = yieldPerHa / crop.referenceYield
    const price = rollPrice(crop.id, yieldIndex, roll)
    const revenue = Math.round(tonnes * price)

    state.harvested = true
    state.harvestedTonnes = tonnes
    state.revenue = revenue
    state.stage = 'recolte'
    this.budget += revenue

    this.push(
      'success',
      state.id,
      `${definition.name} : ${tonnes.toFixed(1)} t de ${crop.shortName.toLowerCase()} ` +
        `(${(yieldPerHa).toFixed(1)} t/ha) vendues ${price.toFixed(0)} €/t.`,
    )
  }

  /**
   * Règlement des sinistres.
   *
   * L'assureur ne paie pas au fil de l'eau : il constate en fin de campagne
   * l'écart entre la récolte de référence et ce qui est rentré, retire la
   * franchise, et verse le reste. Une parcelle simplement médiocre ne déclenche
   * rien — c'est bien le but d'une franchise à 20 %.
   */
  private settleInsurance(): void {
    for (const state of this.parcels) {
      if (!state.insured || !state.crop) continue
      const definition = parcelDefinition(state.id)
      const payout = indemnityFor(state.crop, definition.areaHa, state.revenue)
      state.insurancePayout = payout
      if (payout <= 0) continue

      this.budget += payout
      this.insurancePayout += payout
      this.push(
        'success',
        state.id,
        `${definition.name} : indemnité d’assurance de ${payout.toLocaleString('fr-FR')} €.`,
      )
    }
  }

  private closeCampaign(): void {
    this.finished = true
    this.settleInsurance()
    this.push('info', null, `Campagne terminée. ${this.character.name} — ${this.character.description}`)
  }

  /**
   * Ce qui peut être semé ici, ce tour-ci, et ce qui est refusé.
   *
   * Au premier tour, sur huit parcelles, seules deux ou trois peuvent accueillir
   * la seule culture semable : sans cette information sur les cartes, il faut
   * les ouvrir une par une pour le découvrir.
   */
  sowingOptions(parcelId: number): { available: readonly Crop[]; blocked: readonly Crop[] } {
    const state = this.parcel(parcelId)
    if (state.crop) return { available: [], blocked: [] }

    const available: Crop[] = []
    const blocked: Crop[] = []
    for (const crop of sowableAt(this.turn)) {
      const verdict = this.check({ kind: 'semer', parcelId, crop: crop.id })
      if (verdict.allowed) available.push(crop)
      else blocked.push(crop)
    }
    return { available, blocked }
  }

  /**
   * Ce qu'il faudrait faire sur cette parcelle, maintenant. Une seule action :
   * la plus urgente. Afficher trois conseils simultanés, c'est n'en afficher
   * aucun — le joueur ne saurait plus par quoi commencer.
   */
  advice(parcelId: number): ParcelAdvice | null {
    const state = this.parcel(parcelId)
    if (!state.crop || state.harvested) return null
    const definition = parcelDefinition(parcelId)
    const crop = getCrop(state.crop)
    const soil = getSoil(definition.soil)

    const can = (kind: ActionKind): boolean => this.check({ kind, parcelId }).allowed

    // Récolter prime sur tout : une fenêtre manquée, c'est la parcelle perdue.
    if (can('recolter')) {
      const remaining = crop.harvest.latest - this.turn
      return {
        action: 'recolter',
        label: 'Récolter',
        urgency: remaining <= 1 ? 'urgent' : state.stage === 'mature' ? 'conseille' : 'possible',
        why:
          remaining <= 1
            ? 'Dernier tour avant la fin de la fenêtre : au-delà, la récolte est perdue.'
            : 'La culture est mûre. Attendre gagne encore un peu de rendement, mais expose aux orages.',
      }
    }

    if (state.droughtStreak > 0 && can('irriguer')) {
      return {
        action: 'irriguer',
        label: 'Irriguer',
        urgency: 'urgent',
        why: 'La culture grille sur pied. Un tour d’eau de 30 mm stoppe l’hémorragie.',
      }
    }

    if (state.diseasePressure > 0.65 && can('fongicide')) {
      return {
        action: 'fongicide',
        label: 'Traiter',
        urgency: state.diseasePressure > 0.78 ? 'urgent' : 'conseille',
        why: 'La maladie gagne du terrain et entame la vigueur à chaque tour.',
      }
    }

    if (state.pestPressure > 0.6 && can('insecticide')) {
      return {
        action: 'insecticide',
        label: 'Traiter',
        urgency: state.pestPressure > 0.75 ? 'urgent' : 'conseille',
        why: 'Les ravageurs sont installés. Le produit coûte peu, la perte de récolte beaucoup.',
      }
    }

    // Azote : c'est le levier de rendement le plus rentable, et le plus oublié.
    if (state.nitrogenSplitsDone < crop.nitrogenSplits && can('fertiliser')) {
      const next = crop.nitrogenSchedule[state.nitrogenSplitsDone]
      if (!next) return null
      const inWindow = this.turn >= next.from && this.turn <= next.to
      const late = this.turn > next.to
      return {
        action: 'fertiliser',
        label: 'Fertiliser',
        urgency: inWindow ? 'conseille' : 'possible',
        why: inWindow
          ? `Apport ${state.nitrogenSplitsDone + 1} sur ${crop.nitrogenSplits}, dans sa fenêtre — ${next.label.toLowerCase()}.`
          : late
            ? `Fenêtre dépassée pour l’apport ${state.nitrogenSplitsDone + 1} : il sera mal valorisé.`
            : `Apport ${state.nitrogenSplitsDone + 1} à faire ${labelOfTurn(next.from)} — ${next.label.toLowerCase()}.`,
      }
    }

    if (state.soilWaterMm < soil.waterCapacityMm * 0.2 && can('irriguer')) {
      return {
        action: 'irriguer',
        label: 'Irriguer',
        urgency: 'conseille',
        why: 'La réserve du sol s’épuise. Anticiper coûte moins cher que rattraper.',
      }
    }

    return null
  }

  /**
   * Ce qui vient de frapper, pendant le tour qui s'est déroulé.
   *
   * Grêle, gel, sécheresse, sangliers, limaces : ces coups sont déjà portés
   * quand le joueur reprend la main. Ils n'appellent aucune décision, mais les
   * laisser au fond du récapitulatif revenait à les cacher — le joueur voyait
   * la vigueur chuter sans jamais savoir pourquoi, et le jeu paraissait
   * arbitraire alors qu'il était seulement discret.
   */
  strikes(): readonly ParcelDanger[] {
    const resolved = this.turn - 1
    if (resolved < 0) return []

    const out: ParcelDanger[] = []
    for (const entry of this.log) {
      if (entry.turn !== resolved || entry.kind !== 'damage' || entry.parcelId === null) continue
      const definition = parcelDefinition(entry.parcelId)
      // Le message du journal porte déjà le nom de la parcelle : on le retire
      // pour ne pas l'écrire deux fois sur la carte d'alerte.
      const message = entry.message.startsWith(`${definition.name} : `)
        ? entry.message.slice(definition.name.length + 3)
        : entry.message
      out.push({
        parcelId: entry.parcelId,
        severity: 'sinistre',
        title: definition.name,
        message: message.charAt(0).toUpperCase() + message.slice(1),
      })
    }
    return out
  }

  /**
   * Parcelles qui appellent une décision maintenant. C'est cette liste qui
   * alimente les alertes de l'interface : sans elle, un joueur qui ne scrute
   * pas ses huit cartes découvre le problème quand il est trop tard.
   */
  dangers(): readonly ParcelDanger[] {
    const out: ParcelDanger[] = []
    for (const state of this.parcels) {
      if (!state.crop || state.harvested) continue
      const definition = parcelDefinition(state.id)
      const crop = getCrop(state.crop)
      const soil = getSoil(definition.soil)

      if (state.vigor < 0.4) {
        out.push({
          parcelId: state.id,
          severity: 'critique',
          title: definition.name,
          message: `Couvert très dégradé (${Math.round(state.vigor * 100)} % de vigueur). La parcelle peut être perdue.`,
        })
        continue
      }
      if (state.droughtStreak > 0) {
        out.push({
          parcelId: state.id,
          severity: 'critique',
          title: definition.name,
          message: definition.irrigable
            ? 'La culture manque d’eau. Un tour d’irrigation s’impose.'
            : 'La culture manque d’eau et la parcelle n’est pas irrigable.',
        })
        continue
      }
      if (state.diseasePressure > 0.7) {
        out.push({
          parcelId: state.id,
          severity: 'alerte',
          title: definition.name,
          message: 'La pression maladie est forte. Un fongicide limiterait les pertes.',
        })
        continue
      }
      if (state.pestPressure > 0.65) {
        out.push({
          parcelId: state.id,
          severity: 'alerte',
          title: definition.name,
          message: 'Les ravageurs progressent. Un insecticide s’impose.',
        })
        continue
      }
      // Fin de fenêtre de récolte : le risque le plus coûteux et le plus discret.
      if (this.turn >= crop.harvest.earliest && crop.harvest.latest - this.turn <= 1) {
        out.push({
          parcelId: state.id,
          severity: 'critique',
          title: definition.name,
          message:
            this.turn < state.harvestBlockedUntil
              ? 'Fin de fenêtre de récolte, mais le délai avant récolte n’est pas écoulé.'
              : 'Dernier tour pour récolter avant que la parcelle ne soit perdue.',
        })
        continue
      }
      if (state.soilWaterMm < soil.waterCapacityMm * 0.14 && state.stage !== 'mature') {
        out.push({
          parcelId: state.id,
          severity: 'alerte',
          title: definition.name,
          message: 'La réserve en eau du sol est presque épuisée.',
        })
      }
    }
    return out
  }

  result(): CampaignResult {
    const totalTonnes = this.parcels.reduce((sum, p) => sum + p.harvestedTonnes, 0)
    const harvestRevenue = this.parcels.reduce((sum, p) => sum + p.revenue, 0)
    // Les indemnités sont une recette de la campagne au même titre que le grain :
    // c'est exactement ce qu'on a acheté en payant la prime.
    const totalRevenue = harvestRevenue + this.insurancePayout
    return {
      totalTonnes,
      totalRevenue,
      totalSpent: this.spent,
      margin: totalRevenue - this.spent,
      operatingCost: this.spending.operating,
      structureCost: this.spending.structure,
      financialCost: this.spending.financial,
      contractorCost: this.spending.contractor,
      insuranceCost: this.spending.insurance,
      insurancePayout: this.insurancePayout,
      yearName: this.character.name,
      yearDescription: this.character.description,
    }
  }

  /** Progression 0→1 de la campagne, pour les jauges d'interface. */
  get progress(): number {
    return this.turn / (PERIODS.length - 1)
  }
}
