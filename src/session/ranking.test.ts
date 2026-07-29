import { describe, expect, it } from 'vitest'
import { buildRankings } from './ranking'
import type { RankingEntry } from './protocol'

function entry(pseudo: string, tonnes: number, margin: number, spent: number): RankingEntry {
  return { id: pseudo, pseudo, tonnes, margin, spent, turn: 27, complete: true }
}

describe('classements de session', () => {
  it('classe le tonnage du plus gros au plus faible', () => {
    const { byTonnes } = buildRankings([
      entry('Alice', 380, 12000, 69000),
      entry('Bob', 412, 9000, 74000),
      entry('Chloé', 210, 3000, 51000),
    ])
    expect(byTonnes.map((e) => e.pseudo)).toEqual(['Bob', 'Alice', 'Chloé'])
  })

  it('classe l’argent à la marge dès que quelqu’un a récolté', () => {
    const { byMoney, moneyBasis } = buildRankings([
      entry('Alice', 380, 12000, 69000),
      entry('Bob', 412, 9000, 74000),
      entry('Immobile', 0, -71431, 71431),
    ])
    expect(moneyBasis).toBe('marge')
    expect(byMoney.map((e) => e.pseudo)).toEqual(['Alice', 'Bob', 'Immobile'])
  })

  it('bascule sur les frais engagés quand personne n’a moissonné', () => {
    const { byMoney, moneyBasis } = buildRankings([
      entry('Immobile', 0, -71431, 71431),
      entry('Semeur', 0, -96000, 96000),
      entry('Prudent', 0, -80000, 80000),
    ])
    // Sans bascule, l'immobilisme prendrait la tête : c'est précisément ce
    // qu'on refuse.
    expect(moneyBasis).toBe('engagement')
    expect(byMoney.map((e) => e.pseudo)).toEqual(['Semeur', 'Prudent', 'Immobile'])
  })

  it('départage deux tonnages égaux par la marge', () => {
    const { byTonnes } = buildRankings([
      entry('Alice', 300, 5000, 60000),
      entry('Bob', 300, 8000, 58000),
    ])
    expect(byTonnes[0]?.pseudo).toBe('Bob')
  })

  it('ne bascule pas sur une salle vide', () => {
    expect(buildRankings([]).moneyBasis).toBe('marge')
  })

  it('classe aussi les postes disparus, sur leur dernière remontée', () => {
    const absent: RankingEntry = {
      id: 'p',
      pseudo: 'Déconnecté',
      tonnes: 0,
      margin: -75000,
      spent: 75000,
      turn: 9,
      complete: false,
    }
    const { byMoney } = buildRankings([entry('Alice', 380, 12000, 69000), absent])
    expect(byMoney.map((e) => e.pseudo)).toEqual(['Alice', 'Déconnecté'])
    expect(byMoney[1]?.complete).toBe(false)
  })
})
