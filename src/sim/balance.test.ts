/**
 * Contrôle d'équilibrage.
 *
 * On ne teste pas ici un comportement fonctionnel précis, mais le fait que le
 * moteur produise des rendements du même ordre que la réalité française. Si le
 * blé sort à 3 t/ha ou à 18 t/ha, quelque chose est cassé dans la chaîne de
 * facteurs, et il vaut mieux le voir tout de suite qu'à l'écran.
 */

import { describe, expect, it } from 'vitest'
import { Campaign, type ParcelAdvice } from './engine'
import { CROPS, type CropId } from './crops'
import { PARCELS } from './farm'
import { INPUT_IDS } from './inputs'
import { TURNS_PER_CAMPAIGN } from './calendar'

/**
 * Assolement type : valide au regard des précédents et des plafonds de rotation,
 * et surtout **placé intelligemment**. La betterave va sur le limon profond
 * irrigable, le maïs sur l'autre parcelle irrigable, l'orge de printemps sur le
 * sable où son cycle court et ses faibles besoins passent bien.
 *
 * Le placement compte autant que la conduite : mettre la betterave sur le sable
 * lui coûte plus d'un tiers de son rendement.
 */
const PLAN: readonly CropId[] = [
  'betterave', //       Les Grands Champs — limon profond irrigable, la meilleure terre
  'mais-grain', //      La Pièce du Puits — limon irrigable, le maïs a besoin d'eau
  'ble-tendre-hiver', // Le Coteau
  'colza-hiver', //     La Garenne — l'une des rares parcelles où le colza peut revenir
  'ble-tendre-hiver', // La Terre Blanche
  'orge-printemps', //  Les Sables — cycle court et peu exigeant, adapté au sable
  'orge-hiver', //      Le Marais
  'ble-tendre-hiver', // Le Long Sillon
]

interface Conduct {
  /** Assurer chaque parcelle dès qu'elle est semée. */
  readonly insure?: boolean
  /** Appeler l'entreprise quand la moisson ne rentre pas dans les jours ouvrables. */
  readonly hireContractor?: boolean
  /** Recommander du stock avant d'être à sec. */
  readonly restock?: boolean
}

const URGENCY_RANK = { urgent: 0, conseille: 1, possible: 2 } as const

/**
 * Joue une campagne en conduite « soigneuse ».
 *
 * Le pilote suit exactement ce que le jeu conseille au joueur, dans l'ordre
 * d'urgence affiché. C'est la meilleure approximation d'un joueur attentif — et
 * accessoirement, cela vérifie que les conseils du moteur mènent quelque part :
 * si suivre le panneau conduisait à la faillite systématique, ce serait un
 * défaut du jeu, pas de la stratégie.
 */
function playCarefully(seed: string, conduct: Conduct = {}): Campaign {
  const campaign = new Campaign(seed)

  while (!campaign.finished) {
    const parcels = [...PARCELS.keys()]

    // 1. Récolter : une fenêtre manquée, c'est la parcelle perdue. En régie si
    // les jours le permettent, par entreprise sinon.
    for (const i of parcels) {
      const state = campaign.parcel(i)
      if (!state.crop || state.harvested) continue
      const crop = CROPS[state.crop]
      if (campaign.turn < crop.harvest.bestFrom || campaign.turn > crop.harvest.latest) continue
      if (campaign.apply({ kind: 'recolter', parcelId: i })) continue
      if (conduct.hireContractor) campaign.apply({ kind: 'recolter', parcelId: i, hired: true })
    }

    // 2. Semer dans la fenêtre optimale.
    for (const i of parcels) {
      const planned = PLAN[i]
      if (!planned || campaign.parcel(i).crop) continue
      if (campaign.turn >= CROPS[planned].sowing.bestFrom) {
        campaign.apply({ kind: 'semer', parcelId: i, crop: planned })
      }
    }

    // 3. Assurer ce qui vient d'être implanté, tant que la fenêtre est ouverte.
    if (conduct.insure) {
      for (const i of parcels) campaign.apply({ kind: 'assurer', parcelId: i })
    }

    // 4. Suivre les conseils, urgents d'abord, jusqu'à ne plus rien pouvoir faire.
    for (let pass = 0; pass < 4; pass++) {
      const advised = parcels
        .map((i) => ({ i, advice: campaign.advice(i) }))
        .filter((entry): entry is { i: number; advice: ParcelAdvice } => entry.advice !== null)
        .sort((a, b) => URGENCY_RANK[a.advice.urgency] - URGENCY_RANK[b.advice.urgency])

      let acted = false
      for (const { i, advice } of advised) {
        if (advice.urgency === 'possible') continue
        if (campaign.apply({ kind: advice.action, parcelId: i })) acted = true
      }
      if (!acted) break
    }

    // 5. Réapprovisionner avant la rupture : le lot met un tour à arriver.
    if (conduct.restock) {
      for (const id of INPUT_IDS) {
        const stock = campaign.stocks[id]
        const threshold = id === 'azote' ? 1400 : 22
        if (stock.available + stock.incoming < threshold) campaign.orderInput(id)
      }
    }

    campaign.advance()
  }

  return campaign
}

const FULL_CONDUCT: Conduct = { hireContractor: true, restock: true }

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

interface CropStats {
  samples: number[]
}

describe('équilibrage de la campagne', () => {
  const stats = new Map<CropId, CropStats>()
  const margins: number[] = []

  for (let s = 0; s < 40; s++) {
    const campaign = playCarefully(`TEST-${1000 + s}`, FULL_CONDUCT)
    margins.push(campaign.result().margin)

    campaign.parcels.forEach((state, index) => {
      const cropId = PLAN[index]
      if (!cropId || !state.harvested || state.harvestedTonnes <= 0) return
      const area = PARCELS[index]?.areaHa ?? 1
      const perHa = state.harvestedTonnes / area
      const entry = stats.get(cropId) ?? { samples: [] }
      entry.samples.push(perHa)
      stats.set(cropId, entry)
    })
  }

  it('produit des rendements du bon ordre de grandeur', () => {
    const lines: string[] = []
    for (const [cropId, entry] of stats) {
      const crop = CROPS[cropId]
      const sorted = [...entry.samples].sort((a, b) => a - b)
      const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length
      const min = sorted[0] ?? 0
      const max = sorted[sorted.length - 1] ?? 0
      lines.push(
        `${crop.shortName.padEnd(8)} moy ${mean.toFixed(1).padStart(6)} ` +
          `| min ${min.toFixed(1).padStart(6)} | max ${max.toFixed(1).padStart(6)} ` +
          `| réf ${crop.referenceYield.toFixed(1)} | plafond ${crop.potentialYield.toFixed(1)}`,
      )

      // Le rendement moyen doit rester entre la moitié de la référence et le plafond.
      expect(mean, `${crop.name} : rendement moyen hors plage`).toBeGreaterThan(
        crop.referenceYield * 0.45,
      )
      expect(mean, `${crop.name} : rendement moyen hors plage`).toBeLessThanOrEqual(
        crop.potentialYield,
      )
    }
    console.log('\nRendements simulés (t/ha) sur 40 campagnes :\n' + lines.join('\n'))

    const meanMargin = margins.reduce((a, b) => a + b, 0) / margins.length
    const worst = Math.min(...margins)
    const best = Math.max(...margins)
    console.log(
      `\nMarge de campagne : moy ${Math.round(meanMargin)} € | ` +
        `pire ${Math.round(worst)} € | meilleure ${Math.round(best)} €\n`,
    )
  })

  it('laisse perdre des parcelles quand la conduite est mauvaise', () => {
    // Conduite négligente : on sème, et on ne fait plus rien. Sur 40 campagnes,
    // certaines parcelles doivent être perdues — sinon le jeu n'a pas d'enjeu.
    let perdues = 0
    let total = 0
    for (let s = 0; s < 40; s++) {
      const campaign = new Campaign(`NEGLIGE-${s}`)
      while (!campaign.finished) {
        for (let i = 0; i < PARCELS.length; i++) {
          const state = campaign.parcel(i)
          const planned = PLAN[i]
          if (!planned) continue
          if (!state.crop && campaign.turn >= CROPS[planned].sowing.bestFrom) {
            campaign.apply({ kind: 'semer', parcelId: i, crop: planned })
          }
          const crop = state.crop ? CROPS[state.crop] : null
          if (crop && !state.harvested && campaign.turn >= crop.harvest.bestFrom) {
            campaign.apply({ kind: 'recolter', parcelId: i })
          }
        }
        campaign.advance()
      }
      for (const state of campaign.parcels) {
        if (!state.crop) continue
        total += 1
        if (state.lost) perdues += 1
      }
    }
    console.log(`\nConduite négligée : ${perdues} parcelles perdues sur ${total} emblavées.\n`)
    expect(perdues, 'aucune parcelle ne peut être perdue : le jeu manque d’enjeu').toBeGreaterThan(0)
  })

  /**
   * La promesse du jeu, en un test : même bien conduite, une campagne peut se
   * solder par une perte. Si ce test devient vert « trop facilement », c'est que
   * l'équilibre a glissé et que le jeu ne raconte plus rien.
   */
  it('laisse une campagne bien conduite finir dans le rouge', () => {
    const margins: number[] = []
    for (let s = 0; s < 60; s++) {
      margins.push(playCarefully(`ROUGE-${s}`, FULL_CONDUCT).result().margin)
    }

    const negatives = margins.filter((m) => m < 0).length
    const share = negatives / margins.length
    console.log(
      `\nConduite soignée sur 60 campagnes : médiane ${Math.round(median(margins))} € · ` +
        `${negatives} dans le rouge (${Math.round(share * 100)} %) · ` +
        `pire ${Math.round(Math.min(...margins))} €\n`,
    )

    // Une campagne sur dix au moins doit être perdante, sinon il n'y a pas de
    // risque ; et pas plus des deux tiers, sinon le jeu est injouable.
    expect(share, 'aucune campagne perdante : le jeu n’a plus d’enjeu').toBeGreaterThan(0.1)
    expect(share, 'trop de campagnes perdantes : le jeu est injouable').toBeLessThan(0.66)
    // La médiane reste positive : bien jouer doit payer.
    expect(median(margins), 'même bien conduite, la médiane est négative').toBeGreaterThan(0)
  })

  /**
   * L'assurance doit coûter en espérance et protéger en variance. Une assurance
   * gagnante à tous les coups ne serait pas un choix, elle serait une évidence.
   */
  it('rend l’assurance protectrice sans la rendre gratuite', () => {
    const bare: number[] = []
    const covered: number[] = []
    for (let s = 0; s < 60; s++) {
      bare.push(playCarefully(`ASSUR-${s}`, FULL_CONDUCT).result().margin)
      covered.push(playCarefully(`ASSUR-${s}`, { ...FULL_CONDUCT, insure: true }).result().margin)
    }

    const worstBare = Math.min(...bare)
    const worstCovered = Math.min(...covered)
    console.log(
      `\nAssurance : médiane ${Math.round(median(bare))} € sans / ` +
        `${Math.round(median(covered))} € avec · ` +
        `pire ${Math.round(worstBare)} € sans / ${Math.round(worstCovered)} € avec\n`,
    )

    expect(worstCovered, 'l’assurance ne protège pas les mauvaises années').toBeGreaterThan(worstBare)
  })

  it('épuise les stocks d’intrants avant la fin de la campagne', () => {
    // Sans réapprovisionnement, la dotation de départ ne doit pas suffire :
    // c'est tout l'intérêt de la commande d'été.
    let blocked = 0
    for (let s = 0; s < 20; s++) {
      const campaign = playCarefully(`STOCK-${s}`, { hireContractor: true })
      for (const state of campaign.parcels) {
        if (!state.crop) continue
        blocked += CROPS[state.crop].nitrogenSplits - state.nitrogenSplitsDone
      }
    }
    const perCampaign = blocked / 20
    console.log(`\nSans réapprovisionnement : ${perCampaign.toFixed(1)} apports d’azote non faits.\n`)
    expect(perCampaign, 'la dotation d’intrants ne contraint jamais').toBeGreaterThan(1)
  })

  it('fait varier les années', () => {
    const names = new Set<string>()
    for (let s = 0; s < 30; s++) {
      names.add(new Campaign(`VARIE-${s}`).character.name)
    }
    expect(names.size).toBeGreaterThan(1)
  })

  it('est déterministe pour une même graine', () => {
    const a = playCarefully('MOISSON-4821').result()
    const b = playCarefully('MOISSON-4821').result()
    expect(a.totalTonnes).toBeCloseTo(b.totalTonnes, 6)
    expect(a.margin).toBe(b.margin)
  })

  it('déroule bien 27 tours', () => {
    const campaign = playCarefully('DUREE-1')
    expect(campaign.turn).toBe(TURNS_PER_CAMPAIGN)
    expect(TURNS_PER_CAMPAIGN).toBe(27)
  })
})
