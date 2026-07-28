/**
 * Ruban de campagne.
 *
 * Le calendrier agricole est la chose la plus difficile à deviner pour qui
 * découvre le jeu : on ne peut pas savoir que le colza se sème fin août et se
 * récolte onze mois plus tard. Plutôt que de le faire apprendre par l'échec,
 * ce ruban montre en permanence les 27 tours, les saisons, et — quand une
 * culture est en jeu — ses fenêtres de semis et de récolte.
 *
 * C'est à la fois la barre de progression et le tutoriel permanent.
 */

import { PERIODS, TURNS_PER_CAMPAIGN, type Season } from '../sim/calendar'
import { getCrop, type CropId } from '../sim/crops'

const SEASON_ORDER: readonly Season[] = ['été', 'automne', 'hiver', 'printemps']

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export class Timeline {
  readonly root: HTMLElement
  private readonly track: HTMLElement
  private readonly ticks: HTMLElement[] = []
  private readonly seasonBand: HTMLElement
  private readonly windowBand: HTMLElement
  private readonly cursor: HTMLElement

  constructor(onSelectTurn?: (turn: number) => void) {
    this.root = el('div', 'timeline')

    // --- bande des saisons : quatre blocs continus, pas 27 étiquettes
    this.seasonBand = el('div', 'timeline-seasons')
    let index = 0
    while (index < PERIODS.length) {
      const season = PERIODS[index]?.season
      let span = 0
      while (index + span < PERIODS.length && PERIODS[index + span]?.season === season) span++
      const block = el('div', `season-block season-${SEASON_ORDER.indexOf(season ?? 'été')}`)
      // Les deux bandes partagent la même grille de 27 colonnes : sans ça, les
      // gouttières ne tombent pas au même endroit et les saisons se décalent
      // des crans qu'elles sont censées couvrir.
      block.style.gridColumn = `span ${span}`
      block.append(el('span', 'season-label', season ?? ''))
      this.seasonBand.append(block)
      index += span
    }

    // --- bande des fenêtres de la culture survolée
    this.windowBand = el('div', 'timeline-windows')

    // --- graduations : un cran par tour
    this.track = el('div', 'timeline-track')
    for (let turn = 0; turn < TURNS_PER_CAMPAIGN; turn++) {
      const period = PERIODS[turn]
      const tick = el('button', 'timeline-tick')
      tick.type = 'button'
      tick.title = period?.label ?? ''
      // Un repère plus marqué au changement de mois
      if (period && (period.half === 1 || period.half === 0)) tick.classList.add('is-month-start')
      tick.append(el('span', 'tick-bar'))
      if (onSelectTurn) tick.addEventListener('click', () => onSelectTurn(turn))
      this.ticks.push(tick)
      this.track.append(tick)
    }

    this.cursor = el('div', 'timeline-cursor')
    this.track.append(this.cursor)

    this.root.append(this.seasonBand, this.track, this.windowBand)
  }

  /** Position du curseur et état passé/à venir de chaque cran. */
  setTurn(turn: number): void {
    this.ticks.forEach((tick, index) => {
      tick.classList.toggle('is-past', index < turn)
      tick.classList.toggle('is-current', index === turn)
    })
    const ratio = (turn + 0.5) / TURNS_PER_CAMPAIGN
    this.cursor.style.left = `${ratio * 100}%`
  }

  /**
   * Affiche les fenêtres de semis et de récolte d'une culture.
   * Passer `null` efface la bande.
   */
  showWindowsFor(cropId: CropId | null): void {
    this.windowBand.replaceChildren()
    if (!cropId) {
      this.windowBand.classList.remove('is-active')
      return
    }
    this.windowBand.classList.add('is-active')
    const crop = getCrop(cropId)

    const span = (
      from: number,
      to: number,
      kind: 'sow' | 'harvest' | 'nitrogen',
      label: string,
    ): HTMLElement => {
      const node = el('div', `window-span window-${kind}`)
      const left = (from / TURNS_PER_CAMPAIGN) * 100
      const width = ((to - from + 1) / TURNS_PER_CAMPAIGN) * 100
      node.style.left = `${left}%`
      // Deux pixels de retrait : sans eux, trois apports successifs se touchent
      // et se lisent comme une seule fenêtre continue.
      node.style.width = `calc(${width}% - 2px)`
      node.append(el('span', 'window-label', label))
      node.title = label
      return node
    }

    // Deux lignes : les travaux du sol en haut, la fertilisation en dessous.
    // Sur les cultures de printemps, semis et premier apport se chevauchent —
    // les superposer les rendrait illisibles.
    const work = el('div', 'window-row')
    work.append(
      span(crop.sowing.earliest, crop.sowing.latest, 'sow', 'semis'),
      span(crop.harvest.earliest, crop.harvest.latest, 'harvest', 'récolte'),
    )

    const nitrogen = el('div', 'window-row')
    crop.nitrogenSchedule.forEach((split, index) => {
      nitrogen.append(
        span(
          split.from,
          split.to,
          'nitrogen',
          crop.nitrogenSchedule.length > 1 ? `N${index + 1}` : 'azote',
        ),
      )
    })

    this.windowBand.append(work, nitrogen)
  }
}
