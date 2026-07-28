/**
 * Stocks d'intrants.
 *
 * Un exploitant n'achète pas son azote au tour par tour : il commande en début
 * de campagne, quand les prix sont négociables et que le hangar est vide. Ce
 * qu'il a commandé, il l'a ; ce qu'il n'a pas commandé, il l'achètera au détail,
 * plus cher et avec un délai de livraison.
 *
 * C'est cette avance qui crée l'arbitrage. Avec un stock qui couvre tout, la
 * seule question serait « ai-je les moyens ? ». Avec un stock qui couvre les
 * trois quarts d'un itinéraire complet, la question devient « sur quelles
 * parcelles ? » — et il faut y répondre en février, sans savoir ce que fera le
 * printemps.
 */

export type InputId = 'azote' | 'fongicide' | 'insecticide'

export interface InputDefinition {
  readonly id: InputId
  readonly name: string
  /** Unité de compte, affichée telle quelle dans l'interface. */
  readonly unit: string
  /** Dotation embarquée au départ de la campagne. */
  readonly initialStock: number
  /**
   * Prix unitaire de la commande d'été, en euros.
   * C'est le tarif négocié en achat groupé, sensiblement sous le prix de détail
   * du réapprovisionnement — l'écart est la récompense de l'anticipation.
   */
  readonly bulkUnitPrice: number
  /**
   * Quantité minimale d'un réapprovisionnement.
   * On ne fait pas venir un camion pour deux sacs.
   */
  readonly restockLot: number
  /** Prix du lot de réapprovisionnement, en euros. */
  readonly restockPrice: number
  /** Nombre de tours avant que le lot commandé soit disponible. */
  readonly leadTimeTurns: number
}

/**
 * Les dotations sont calées sur un assolement de référence à 96 ha.
 *
 * Azote : un assolement classique demande de l'ordre de 15 000 unités sur la
 * campagne. La dotation en couvre un peu moins des deux tiers — de quoi
 * conduire correctement cinq parcelles sur huit, pas les huit.
 *
 * Fongicide et insecticide se comptent en hectares traités : un « ha-dose »
 * traite un hectare une fois. Un itinéraire complet sur tout l'assolement
 * demanderait environ 130 ha-doses de fongicide et 95 d'insecticide.
 *
 * Le manque est délibéré, et il est calibré pour que le joueur s'en aperçoive
 * en février — au moment des premiers apports, quand il reste huit tours et où
 * il faut choisir quelles parcelles on conduit à fond et lesquelles on laisse
 * en second rang.
 */
export const INPUTS: Record<InputId, InputDefinition> = {
  azote: {
    id: 'azote',
    name: 'Azote',
    unit: 'U',
    initialStock: 8000,
    bulkUnitPrice: 0.95,
    restockLot: 1500,
    // ~1,15 €/unité au détail, contre 0,95 € en commande groupée d'été.
    restockPrice: 1725,
    leadTimeTurns: 1,
  },
  fongicide: {
    id: 'fongicide',
    name: 'Fongicide',
    unit: 'ha',
    initialStock: 42,
    bulkUnitPrice: 28,
    restockLot: 25,
    // ~34 €/ha au détail contre 28 € en contrat de campagne.
    restockPrice: 850,
    leadTimeTurns: 1,
  },
  insecticide: {
    id: 'insecticide',
    name: 'Insecticide',
    unit: 'ha',
    initialStock: 30,
    bulkUnitPrice: 21,
    restockLot: 20,
    restockPrice: 420,
    leadTimeTurns: 1,
  },
}

/**
 * Facture de la commande d'été, en euros.
 *
 * Elle est payée au premier tour, avant la moindre décision. C'est ce qui rend
 * la trésorerie de départ lisible : on ne commence pas avec un magot, on
 * commence avec un hangar rempli et un compte déjà entamé.
 */
export const INITIAL_ORDER_COST = Math.round(
  Object.values(INPUTS).reduce((sum, input) => sum + input.initialStock * input.bulkUnitPrice, 0),
)

export const INPUT_IDS: readonly InputId[] = ['azote', 'fongicide', 'insecticide']

export function inputDefinition(id: InputId): InputDefinition {
  return INPUTS[id]
}

/** Une commande passée, pas encore livrée. */
export interface PendingDelivery {
  readonly input: InputId
  readonly quantity: number
  /** Tour à partir duquel la marchandise entre en stock. */
  readonly arrivesAtTurn: number
}

export interface InputStock {
  /** Quantité immédiatement disponible. */
  available: number
  /** Quantité commandée et en route. */
  incoming: number
}

export type InputStocks = Record<InputId, InputStock>

export function freshStocks(): InputStocks {
  return {
    azote: { available: INPUTS.azote.initialStock, incoming: 0 },
    fongicide: { available: INPUTS.fongicide.initialStock, incoming: 0 },
    insecticide: { available: INPUTS.insecticide.initialStock, incoming: 0 },
  }
}
