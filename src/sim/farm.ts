/**
 * Définition de l'exploitation.
 *
 * La ferme est fixe d'une partie à l'autre : mêmes parcelles, mêmes sols.
 * Seule la météo change avec la graine. C'est ce qui rend deux campagnes
 * comparables — et un code de campagne partageable réellement équitable.
 *
 * Échelle : 1 unité de monde = 10 mètres. Une parcelle de 38 × 30 unités
 * fait donc 380 m × 300 m, soit 11,4 ha — une taille courante en plaine.
 */

import type { CropId } from './crops'
import type { SoilId } from './soils'

export const UNITS_PER_METER = 0.1
export const HECTARES_PER_SQUARE_UNIT = 0.01

export interface ParcelFootprint {
  /** Centre de la parcelle dans le plan horizontal. */
  readonly x: number
  readonly z: number
  readonly width: number
  readonly depth: number
}

export interface ParcelDefinition {
  readonly id: number
  readonly name: string
  readonly soil: SoilId
  /**
   * Précédents culturaux, du plus récent au plus ancien : ce qui poussait là
   * l'an dernier, il y a deux ans, il y a trois ans.
   *
   * Sans cette mémoire, le joueur ne comprend pas pourquoi il ne peut pas
   * mettre du colza quelque part — et la contrainte de rotation paraît
   * arbitraire alors qu'elle est la règle agronomique la plus basique.
   */
  readonly history: readonly CropId[]
  readonly footprint: ParcelFootprint
  /** Surface en hectares, dérivée de l'emprise. */
  readonly areaHa: number
  /** Parcelle desservie par le réseau d'irrigation ? */
  readonly irrigable: boolean
  /**
   * Parcelle en lisière de bois.
   *
   * Ce n'est pas un détail de décor : le gibier ne traverse pas la plaine, il
   * sort du couvert et travaille la première parcelle qu'il trouve. Sur une
   * exploitation réelle, ce sont toujours les mêmes champs qui se font
   * retourner, année après année.
   */
  readonly nearWoods: boolean
}

interface RawParcel {
  readonly name: string
  readonly soil: SoilId
  readonly history: readonly CropId[]
  readonly x: number
  readonly z: number
  readonly width: number
  readonly depth: number
  readonly irrigable: boolean
}

/**
 * Le parcellaire tient sur une grille régulière de trois colonnes et trois
 * rangées, séparées par les chemins d'exploitation. Les huit parcelles occupent
 * huit des neuf cases ; la neuvième porte le corps de ferme.
 *
 * Cette régularité n'est pas qu'une commodité de code : un parcellaire aux
 * bords désalignés se lit comme un bug à l'écran, alors qu'un remembrement
 * franc — celui qu'ont connu la plupart des plaines céréalières — donne
 * immédiatement l'échelle et la direction des chemins.
 */

/** Axes de la grille : bords communs à toutes les rangées et colonnes. */
const COLUMNS = [
  { x: -48, width: 44 }, //  -70 → -26
  { x: 0, width: 40 }, //    -20 →  20
  { x: 48, width: 44 }, //    26 →  70
] as const

const ROWS = [
  { z: -36, depth: 30 }, //  -51 → -21
  { z: 0, depth: 26 }, //    -13 →  13
  { z: 36, depth: 30 }, //    21 →  51
] as const

/** Largeur des chemins d'exploitation, déduite des axes ci-dessus. */
export const LANE_WIDTH_X = COLUMNS[1].x - COLUMNS[1].width / 2 - (COLUMNS[0].x + COLUMNS[0].width / 2)
export const LANE_WIDTH_Z = ROWS[1].z - ROWS[1].depth / 2 - (ROWS[0].z + ROWS[0].depth / 2)

/** Emprise totale du bloc cultivé, chemins compris. */
export const BLOCK_HALF_WIDTH = COLUMNS[2].x + COLUMNS[2].width / 2
export const BLOCK_HALF_DEPTH = ROWS[2].z + ROWS[2].depth / 2

interface GridPlacement {
  readonly column: 0 | 1 | 2
  readonly row: 0 | 1 | 2
}

function cell(placement: GridPlacement): Pick<RawParcel, 'x' | 'z' | 'width' | 'depth'> {
  const column = COLUMNS[placement.column]
  const row = ROWS[placement.row]
  return { x: column.x, z: row.z, width: column.width, depth: row.depth }
}

/**
 * Huit parcelles nommées comme on le fait vraiment à la ferme : d'après un
 * lieu-dit, une forme ou un voisin.
 *
 * Total ≈ 96 ha, soit exactement la SAU moyenne d'une exploitation française
 * en céréales et oléoprotéagineux (recensement agricole 2020). Les parcelles
 * font 10 à 14 ha : au-dessus de la moyenne nationale des terres arables
 * (3,6 ha), mais cohérent avec le Bassin parisien où les parcelles de plus de
 * 6,8 ha portent déjà plus de la moitié des surfaces — et nécessaire pour
 * qu'une parcelle reste lisible à l'écran.
 */
const RAW_PARCELS: readonly RawParcel[] = [
  { name: 'Les Grands Champs', soil: 'limon', ...cell({ column: 0, row: 0 }), irrigable: true, history: ['ble-tendre-hiver', 'colza-hiver', 'ble-tendre-hiver'] },
  { name: 'La Pièce du Puits', soil: 'limon', ...cell({ column: 1, row: 0 }), irrigable: true, history: ['orge-hiver', 'ble-tendre-hiver', 'colza-hiver'] },
  { name: 'Le Coteau', soil: 'argilo-calcaire', ...cell({ column: 2, row: 0 }), irrigable: false, history: ['colza-hiver', 'ble-tendre-hiver', 'orge-hiver'] },
  { name: 'La Garenne', soil: 'argilo-calcaire', ...cell({ column: 0, row: 1 }), irrigable: false, history: ['ble-tendre-hiver', 'orge-printemps', 'ble-tendre-hiver'] },
  { name: 'La Terre Blanche', soil: 'craie', ...cell({ column: 1, row: 1 }), irrigable: true, history: ['ble-tendre-hiver', 'betterave', 'ble-tendre-hiver'] },
  { name: 'Les Sables', soil: 'sable', ...cell({ column: 2, row: 1 }), irrigable: true, history: ['mais-grain', 'ble-tendre-hiver', 'tournesol'] },
  { name: 'Le Marais', soil: 'argile', ...cell({ column: 0, row: 2 }), irrigable: false, history: ['ble-tendre-hiver', 'colza-hiver', 'ble-tendre-hiver'] },
  { name: 'Le Long Sillon', soil: 'limon', ...cell({ column: 1, row: 2 }), irrigable: false, history: ['betterave', 'ble-tendre-hiver', 'orge-hiver'] },
]

/**
 * Les parcelles d'angle : celles que le bocage enveloppe sur deux côtés.
 *
 * Toutes les parcelles du pourtour touchent le bois par une bordure, mais c'est
 * dans les angles que le gibier trouve son couvert et sa coulée — et ce sont
 * toujours les mêmes champs qui se font retourner, année après année. On le
 * déduit de la position plutôt que de le déclarer à la main : la carte et la
 * règle du jeu disent alors forcément la même chose.
 */
function bordersWoods(raw: RawParcel): boolean {
  const outerRow = Math.abs(raw.z) === Math.max(...ROWS.map((row) => Math.abs(row.z)))
  const outerColumn = Math.abs(raw.x) === Math.max(...COLUMNS.map((column) => Math.abs(column.x)))
  return outerRow && outerColumn
}

function buildParcels(): readonly ParcelDefinition[] {
  return RAW_PARCELS.map((raw, index) => ({
    id: index,
    name: raw.name,
    soil: raw.soil,
    footprint: { x: raw.x, z: raw.z, width: raw.width, depth: raw.depth },
    history: raw.history,
    areaHa: Math.round(raw.width * raw.depth * HECTARES_PER_SQUARE_UNIT * 10) / 10,
    irrigable: raw.irrigable,
    nearWoods: bordersWoods(raw),
  }))
}

export const PARCELS: readonly ParcelDefinition[] = buildParcels()

export const TOTAL_AREA_HA = Math.round(PARCELS.reduce((sum, p) => sum + p.areaHa, 0) * 10) / 10

export function parcelDefinition(id: number): ParcelDefinition {
  const parcel = PARCELS[id]
  if (!parcel) throw new Error(`Parcelle inconnue : ${id}`)
  return parcel
}

/**
 * Emplacement du corps de ferme : la neuvième case de la grille, celle que les
 * parcelles laissent libre. Une ferme posée au milieu de ses terres, et non
 * reléguée au bout du terrain, donne un point de repère à la caméra.
 */
export const FARMSTEAD = { x: COLUMNS[2].x, z: ROWS[2].z } as const
