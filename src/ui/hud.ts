/**
 * Interface de jeu.
 *
 * DOM et CSS, posés au-dessus du canvas. Le HUD ne connaît que l'état de la
 * campagne : il ne décide rien, il émet des intentions que le jeu applique.
 */

import { labelOfTurn, periodAt, TURNS_PER_CAMPAIGN } from '../sim/calendar'
import { CROP_IDS, getCrop, sowableAt, type CropId } from '../sim/crops'
import { economicsOf } from '../sim/economics'
import type { Action, Campaign, LogEntry, ParcelState } from '../sim/engine'
import { parcelDefinition, TOTAL_AREA_HA } from '../sim/farm'
import { hazardName } from '../sim/hazards'
import { INPUT_IDS, inputDefinition, type InputId } from '../sim/inputs'
import { DEDUCTIBLE } from '../sim/insurance'
import { getSoil } from '../sim/soils'
import type { Weather } from '../sim/weather'
import { Timeline } from './timeline'

export interface HudCallbacks {
  readonly onAction: (action: Action) => void
  readonly onAdvance: () => void
  readonly onSelectParcel: (id: number | null) => void
  readonly onToggleAudio: () => void
  readonly onOrderInput: (id: InputId) => void
  readonly onShowBriefing: () => void
}

const STAGE_LABELS: Record<string, string> = {
  vide: 'Nue',
  seme: 'Semée',
  levee: 'Levée',
  croissance: 'Croissance',
  floraison: 'Floraison',
  remplissage: 'Remplissage',
  mature: 'Mûre',
  recolte: 'Récoltée',
}

/**
 * Ce que fait chaque intervention, en une phrase. Le jeu ne peut pas se
 * contenter d'afficher un bouton et un prix : sans la raison agronomique,
 * le joueur clique au hasard ou ne clique pas du tout.
 */
const ACTION_EXPLANATIONS: Record<Action['kind'], string> = {
  semer: 'Implante la culture pour toute la campagne.',
  fertiliser:
    'Apporte l’azote qui construit le rendement. Un programme incomplet plafonne la récolte, quelle que soit la météo.',
  irriguer:
    '30 mm d’eau. Sur maïs, un tour rapporte plus de 10 quintaux en année sèche — et rien du tout en année humide.',
  fongicide:
    'Enraye les maladies foliaires. Attention : pose un délai avant récolte qui peut repousser la moisson.',
  insecticide:
    'Traite les ravageurs installés. Le produit est bon marché ; c’est la perte de récolte qui coûte cher.',
  recolter: 'Rentre la récolte et encaisse la vente au prix de campagne.',
  assurer:
    `Couvre la parcelle contre les pertes de récolte. Franchise de ${Math.round(DEDUCTIBLE * 100)} % : ` +
    'une année simplement médiocre ne déclenche rien.',
}

const ACTION_LABELS: Record<Action['kind'], string> = {
  semer: 'Semer',
  fertiliser: 'Fertiliser',
  irriguer: 'Irriguer',
  fongicide: 'Fongicide',
  insecticide: 'Insecticide',
  recolter: 'Récolter',
  assurer: 'Assurer',
}

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

function euros(value: number): string {
  return `${Math.round(value).toLocaleString('fr-FR')} €`
}

export class Hud {
  readonly root: HTMLElement

  private readonly dateLabel: HTMLElement
  private readonly seasonLabel: HTMLElement
  private readonly timeline: Timeline
  private readonly budgetValue: HTMLElement
  private readonly spentValue: HTMLElement
  private readonly weatherPanel: HTMLElement
  private readonly forecastPanel: HTMLElement
  private readonly stockPanel: HTMLElement
  private readonly parcelStrip: HTMLElement
  private readonly detailPanel: HTMLElement
  private readonly logPanel: HTMLElement
  private readonly advanceButton: HTMLButtonElement
  private readonly audioButton: HTMLButtonElement

  private selectedParcel: number | null = null
  private lastLogLength = 0

  constructor(parent: HTMLElement, private readonly callbacks: HudCallbacks) {
    this.root = el('div', 'hud')

    // ---- bandeau supérieur
    const top = el('header', 'hud-top')

    const dateBlock = el('div', 'hud-date')
    this.dateLabel = el('div', 'hud-date-main', '—')
    this.seasonLabel = el('div', 'hud-date-sub', '')
    dateBlock.append(this.dateLabel, this.seasonLabel)

    this.timeline = new Timeline()

    const money = el('div', 'hud-money')
    this.budgetValue = el('div', 'hud-money-value', '—')
    const budgetLabel = el('div', 'hud-money-label', 'Trésorerie')
    this.spentValue = el('div', 'hud-money-spent', '')
    money.append(budgetLabel, this.budgetValue, this.spentValue)

    this.audioButton = el('button', 'hud-icon-button', '🔇')
    this.audioButton.title = 'Activer le son'
    this.audioButton.addEventListener('click', () => this.callbacks.onToggleAudio())

    // Le mémo reste accessible en permanence : les contraintes de la campagne
    // s'oublient entre deux parties, et rien d'autre ne les rappelle.
    const briefingButton = el('button', 'hud-icon-button', '?')
    briefingButton.title = 'Revoir le mémo de campagne'
    briefingButton.setAttribute('aria-label', 'Revoir le mémo de campagne')
    briefingButton.addEventListener('click', () => this.callbacks.onShowBriefing())

    // Les icônes voyagent ensemble : la grille du bandeau a des colonnes fixes,
    // un enfant de plus la ferait déborder.
    const tools = el('div', 'hud-tools')
    tools.append(briefingButton, this.audioButton)

    top.append(dateBlock, this.timeline.root, money, tools)

    // ---- colonne de gauche : météo, prévisions, puis récapitulatif.
    // Le récapitulatif est en bas de colonne et défile sur lui-même : il ne
    // pousse plus les panneaux du dessus et ne masque plus le paysage.
    const weatherColumn = el('aside', 'hud-weather')
    this.weatherPanel = el('div', 'panel weather-now')
    this.forecastPanel = el('div', 'panel weather-forecast')
    this.stockPanel = el('div', 'panel hud-stocks')
    this.logPanel = el('div', 'panel hud-log')
    weatherColumn.append(this.weatherPanel, this.forecastPanel, this.stockPanel, this.logPanel)

    // ---- détail de parcelle
    this.detailPanel = el('aside', 'panel hud-detail')
    this.detailPanel.hidden = true

    // ---- bas d'écran
    const bottom = el('footer', 'hud-bottom')
    this.parcelStrip = el('div', 'parcel-strip')
    this.advanceButton = el('button', 'primary-button advance-button', 'Passer au tour suivant')
    this.advanceButton.addEventListener('click', () => this.callbacks.onAdvance())
    bottom.append(this.parcelStrip, this.advanceButton)

    this.root.append(top, weatherColumn, this.detailPanel, bottom)
    parent.append(this.root)
  }

  setAudioEnabled(enabled: boolean): void {
    this.audioButton.textContent = enabled ? '🔊' : '🔇'
    this.audioButton.title = enabled ? 'Couper le son' : 'Activer le son'
  }

  select(id: number | null): void {
    this.selectedParcel = id
  }

  get selected(): number | null {
    return this.selectedParcel
  }

  render(campaign: Campaign): void {
    this.renderTop(campaign)
    this.renderWeather(campaign)
    this.renderStocks(campaign)
    this.renderParcels(campaign)
    this.renderDetail(campaign)
    this.renderLog(campaign)
  }

  // ------------------------------------------------------------ bandeau

  private renderTop(campaign: Campaign): void {
    const period = periodAt(campaign.turn)
    this.dateLabel.textContent = labelOfTurn(campaign.turn)
    const season = period.season.charAt(0).toUpperCase() + period.season.slice(1)
    this.seasonLabel.textContent = `${season} · tour ${campaign.turn + 1} sur ${TURNS_PER_CAMPAIGN}`
    this.timeline.setTurn(campaign.turn)
    this.budgetValue.textContent = euros(campaign.budget)
    // Une trésorerie négative n'est pas une anomalie : une campagne se finance à
    // découvert. Ce qui compte, c'est la distance au plafond de la banque.
    this.budgetValue.classList.toggle('is-low', campaign.creditLeft < 15000)
    this.budgetValue.classList.toggle('is-overdrawn', campaign.budget < 0)
    this.spentValue.textContent =
      campaign.budget < 0
        ? `Découvert · ${euros(campaign.creditLeft)} encore disponibles`
        : `${euros(campaign.spent)} engagés · ${TOTAL_AREA_HA} ha`
  }

  // ------------------------------------------------------------ hangar

  /**
   * Ce qu'il reste en hangar.
   *
   * C'est l'information qui change le plus les décisions du milieu de campagne,
   * et elle n'existe nulle part ailleurs : sans elle, le joueur découvre qu'il
   * est à sec au moment où il clique, c'est-à-dire trop tard pour commander.
   */
  private renderStocks(campaign: Campaign): void {
    this.stockPanel.replaceChildren()
    this.stockPanel.append(el('h2', 'panel-title', 'Le hangar'))

    for (const id of INPUT_IDS) {
      const definition = inputDefinition(id)
      const stock = campaign.stocks[id]
      const row = el('div', 'stock-row')

      const head = el('div', 'stock-head')
      head.append(
        el('span', 'stock-name', definition.name),
        el(
          'span',
          'stock-qty',
          `${Math.round(stock.available)} ${definition.unit}`,
        ),
      )
      row.append(head)

      const share = Math.max(0, Math.min(1, stock.available / definition.initialStock))
      const bar = el('div', 'stock-bar')
      const fill = el('span', 'stock-fill')
      fill.style.width = `${share * 100}%`
      fill.classList.toggle('is-low', share < 0.25)
      bar.append(fill)
      row.append(bar)

      if (stock.incoming > 0) {
        row.append(
          el('p', 'stock-incoming', `${Math.round(stock.incoming)} ${definition.unit} en route`),
        )
      }

      const order = campaign.checkOrder(id)
      const button = el('button', 'stock-order')
      button.disabled = !order.allowed
      button.append(
        el('span', 'stock-order-label', `Commander ${definition.restockLot} ${definition.unit}`),
        el('span', 'stock-order-cost', euros(definition.restockPrice)),
      )
      button.title = order.allowed
        ? `Livraison dans ${definition.leadTimeTurns} tour${definition.leadTimeTurns > 1 ? 's' : ''}. ` +
          'Le prix de détail est au-dessus de celui de la commande d’été.'
        : (order.reason ?? 'Indisponible')
      button.addEventListener('click', () => this.callbacks.onOrderInput(id))
      row.append(button)

      this.stockPanel.append(row)
    }
  }

  // ------------------------------------------------------------ météo

  private renderWeather(campaign: Campaign): void {
    const weather = campaign.currentWeather()
    this.weatherPanel.replaceChildren()
    this.weatherPanel.append(el('h2', 'panel-title', 'Le temps qu’il fait'))

    const grid = el('div', 'weather-grid')
    grid.append(
      this.stat('Moyenne', `${weather.tempMean.toFixed(1)} °C`),
      this.stat('Mini', `${weather.tempMin.toFixed(1)} °C`),
      this.stat('Maxi', `${weather.tempMax.toFixed(1)} °C`),
      this.stat('Pluie', `${Math.round(weather.rainMm)} mm`),
      this.stat('Jours de pluie', `${weather.rainDays}`),
      this.stat('Rafales', `${Math.round(weather.windMaxKmh)} km/h`),
    )
    this.weatherPanel.append(grid)

    if (weather.events.length > 0) {
      const events = el('div', 'event-tags')
      for (const event of weather.events) {
        const tag = el('span', `event-tag event-${event.id}`, event.label)
        events.append(tag)
      }
      this.weatherPanel.append(events)
    }

    // ---- prévisions
    this.forecastPanel.replaceChildren()
    this.forecastPanel.append(el('h2', 'panel-title', 'Prévisions'))
    const forecasts = campaign.forecasts()
    if (forecasts.length === 0) {
      this.forecastPanel.append(el('p', 'muted', 'Fin de campagne : plus rien à prévoir.'))
      return
    }

    for (const forecast of forecasts) {
      const row = el('div', 'forecast-row')
      const when = el('div', 'forecast-when', labelOfTurn(forecast.turn))
      const values = el('div', 'forecast-values')
      values.append(
        el('span', '', `${forecast.tempMean.toFixed(0)} °C`),
        el('span', '', `${Math.round(forecast.expectedRainMm)} mm`),
        el('span', '', `${Math.round(forecast.rainProbability * 100)} % de pluie`),
      )

      const reliability = el('div', 'forecast-reliability')
      const bar = el('div', 'forecast-reliability-fill')
      bar.style.width = `${forecast.reliability * 100}%`
      reliability.append(bar)
      reliability.title = `Fiabilité ${Math.round(forecast.reliability * 100)} %`

      row.append(when, values, reliability)

      if (forecast.warnings.length > 0) {
        const warnings = el('div', 'forecast-warnings')
        for (const warning of forecast.warnings) {
          warnings.append(el('span', 'warning-chip', warning))
        }
        row.append(warnings)
      }
      this.forecastPanel.append(row)
    }
  }

  private stat(label: string, value: string): HTMLElement {
    const node = el('div', 'stat')
    node.append(el('span', 'stat-label', label), el('span', 'stat-value', value))
    return node
  }

  // ------------------------------------------------------------ parcelles

  private renderParcels(campaign: Campaign): void {
    this.parcelStrip.replaceChildren()

    for (const state of campaign.parcels) {
      const definition = parcelDefinition(state.id)
      const card = el('button', 'parcel-card')
      card.classList.toggle('is-selected', state.id === this.selectedParcel)

      const name = el('div', 'parcel-name', definition.name)
      const crop = state.crop ? getCrop(state.crop) : null
      const cropLine = el(
        'div',
        'parcel-crop',
        crop ? crop.shortName : 'Libre',
      )
      if (crop) cropLine.classList.add(`crop-${crop.id}`)

      const meta = el('div', 'parcel-meta')
      meta.append(
        el('span', '', `${definition.areaHa} ha`),
        el('span', '', STAGE_LABELS[state.stage] ?? state.stage),
      )

      card.append(name, cropLine, meta)

      if (state.lost) {
        card.classList.add('is-lost')
        card.append(el('div', 'parcel-lost', 'Parcelle perdue'))
      } else if (!state.crop) {
        // Parcelle libre : on annonce sur la carte ce qu'on peut y semer, pour
        // éviter d'avoir à ouvrir les huit parcelles une par une.
        const { available, blocked } = campaign.sowingOptions(state.id)
        if (available.length === 1 && available[0]) {
          card.classList.add('is-sowable')
          card.append(el('div', 'parcel-sow is-open', `Semer : ${available[0].shortName}`))
        } else if (available.length > 1) {
          card.classList.add('is-sowable')
          card.append(el('div', 'parcel-sow is-open', `${available.length} semis possibles`))
        } else if (blocked.length > 0) {
          card.append(el('div', 'parcel-sow is-blocked', 'Rotation : indisponible'))
        } else {
          card.append(el('div', 'parcel-sow is-idle', 'Hors période de semis'))
        }
      } else if (state.crop && !state.harvested) {
        const water = state.soilWaterMm / getSoil(definition.soil).waterCapacityMm

        // L'état général se lit d'abord à la couleur du liseré de la carte,
        // avant même d'avoir déchiffré les barres.
        if (state.vigor < 0.4 || state.droughtStreak > 0) card.classList.add('is-critical')
        else if (state.diseasePressure > 0.65 || state.pestPressure > 0.6 || water < 0.15) {
          card.classList.add('is-warning')
        }

        const crop = getCrop(state.crop)
        const maturity = Math.min(1, state.gdd / crop.physiology.gddMaturity)

        const bars = el('div', 'parcel-bars')
        bars.append(
          this.bar('Vigueur', state.vigor, state.vigor < 0.4 ? 'bar-critical' : 'bar-vigor'),
          this.bar('Eau du sol', water, water < 0.15 ? 'bar-critical' : 'bar-water'),
          this.bar('Maturité', maturity, 'bar-maturity'),
        )
        card.append(bars)

        // Programme azoté en pastilles pleines/vides : c'est l'information
        // qui manquait le plus pour décider quoi faire d'un simple coup d'œil.
        const nitrogen = el('div', 'parcel-nitrogen')
        nitrogen.title = `Azote : ${state.nitrogenSplitsDone} apport(s) sur ${crop.nitrogenSplits}`
        nitrogen.append(el('span', 'nitrogen-label', 'N'))
        for (let i = 0; i < crop.nitrogenSplits; i++) {
          nitrogen.append(el('span', `nitrogen-dot${i < state.nitrogenSplitsDone ? ' is-done' : ''}`))
        }
        card.append(nitrogen)

        const alerts = el('div', 'parcel-alerts')
        // Trois niveaux plutôt qu'une pastille binaire : le joueur doit pouvoir
        // distinguer « ça commence » de « il faut intervenir tout de suite ».
        this.pressureChip(alerts, 'Maladie', state.diseasePressure, 0.5, 0.72, 'alert-disease')
        this.pressureChip(alerts, 'Ravageurs', state.pestPressure, 0.45, 0.65, 'alert-pest')
        if (state.droughtStreak > 0) {
          alerts.append(el('span', 'alert alert-drought', `Sec ×${state.droughtStreak}`))
        }
        if (state.lodged) alerts.append(el('span', 'alert alert-lodged', 'Versée'))
        if (campaign.turn < state.harvestBlockedUntil) {
          alerts.append(el('span', 'alert alert-dar', 'DAR'))
        }
        // Les sinistres laissent une trace : la perte de vigueur reste visible
        // toute la campagne, sa cause doit l'être aussi.
        for (const id of state.hazardsSuffered) {
          alerts.append(el('span', 'alert alert-hazard', hazardName(id)))
        }
        if (state.insured) alerts.append(el('span', 'alert alert-insured', 'Assurée'))
        if (alerts.childElementCount > 0) card.append(alerts)

        const advice = campaign.advice(state.id)
        if (advice && advice.urgency !== 'possible') {
          const badge = el('div', `parcel-advice is-${advice.urgency}`, advice.label)
          badge.title = advice.why
          card.append(badge)
        }
      } else if (state.harvested && state.harvestedTonnes > 0) {
        card.append(
          el('div', 'parcel-result', `${state.harvestedTonnes.toFixed(1)} t · ${euros(state.revenue)}`),
        )
      }

      card.addEventListener('click', () => {
        const next = this.selectedParcel === state.id ? null : state.id
        this.selectedParcel = next
        this.callbacks.onSelectParcel(next)
      })

      this.parcelStrip.append(card)
    }
  }

  /** Pastille d'alerte à trois niveaux : naissante, installée, critique. */
  private pressureChip(
    parent: HTMLElement,
    label: string,
    value: number,
    low: number,
    high: number,
    className: string,
  ): void {
    if (value < low) return
    const level = value >= high ? 3 : value >= (low + high) / 2 ? 2 : 1
    const chip = el('span', `alert ${className} level-${level}`, label)
    chip.append(el('span', 'alert-dots', '·'.repeat(level)))
    chip.title = `${label} — ${Math.round(value * 100)} %`
    parent.append(chip)
  }

  /**
   * Barre d'état avec son initiale. Sans cette lettre, trois barres empilées
   * sont indiscernables sur une carte de 130 pixels de large — et une infobulle
   * ne se lit pas d'un coup d'œil.
   */
  private bar(label: string, value: number, className: string): HTMLElement {
    const row = el('div', 'mini-bar-row')
    row.title = `${label} — ${Math.round(value * 100)} %`
    row.append(el('span', 'mini-bar-initial', label.charAt(0)))
    const wrap = el('div', 'mini-bar')
    const fill = el('div', `mini-bar-fill ${className}`)
    fill.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`
    wrap.append(fill)
    row.append(wrap)
    return row
  }

  // ------------------------------------------------------------ détail

  private renderDetail(campaign: Campaign): void {
    if (this.selectedParcel === null) {
      this.detailPanel.hidden = true
      this.timeline.showWindowsFor(null)
      return
    }
    this.detailPanel.hidden = false
    this.detailPanel.replaceChildren()

    const state = campaign.parcel(this.selectedParcel)
    const definition = parcelDefinition(state.id)
    const soil = getSoil(definition.soil)

    this.detailPanel.append(el('h2', 'panel-title', definition.name))
    this.detailPanel.append(
      el('p', 'muted', `${definition.areaHa} ha · ${soil.name}${definition.irrigable ? ' · irrigable' : ''}`),
    )
    this.detailPanel.append(el('p', 'soil-note', soil.description))

    if (!state.crop) {
      // Les précédents n'ont d'intérêt qu'au moment de choisir : ils expliquent
      // la moitié des refus de semis. Une fois la parcelle emblavée, la place
      // revient à l'état de la culture.
      const history = el('div', 'history')
      history.append(el('div', 'history-label', 'Précédents culturaux'))
      const chips = el('div', 'history-chips')
      definition.history.forEach((cropId, index) => {
        const chip = el('span', 'history-chip')
        chip.append(
          el('span', 'history-crop', getCrop(cropId).shortName),
          el('span', 'history-when', index === 0 ? 'l’an dernier' : `il y a ${index + 1} ans`),
        )
        chips.append(chip)
      })
      history.append(chips)
      this.detailPanel.append(history)
    }

    if (!state.crop) {
      this.renderSowingChoices(campaign, state)
    } else {
      this.renderCropStatus(campaign, state)
    }
  }

  private renderSowingChoices(campaign: Campaign, state: ParcelState): void {
    const available = sowableAt(campaign.turn)
    if (available.length === 0) {
      const next = CROP_IDS.map(getCrop)
        .filter((crop) => crop.sowing.earliest > campaign.turn)
        .sort((a, b) => a.sowing.earliest - b.sowing.earliest)[0]
      this.detailPanel.append(
        el(
          'p',
          'muted',
          next
            ? `Rien à semer maintenant. Prochaine fenêtre : ${next.name.toLowerCase()}, ${labelOfTurn(next.sowing.earliest)}.`
            : 'Plus aucune fenêtre de semis sur cette campagne.',
        ),
      )
      return
    }

    this.detailPanel.append(el('h3', 'section-title', 'Semer'))
    const list = el('div', 'sow-list')

    for (const crop of available) {
      const action: Action = { kind: 'semer', parcelId: state.id, crop: crop.id }
      const verdict = campaign.check(action)
      const quality = this.sowingQualityLabel(crop.id, campaign.turn)

      const button = el('button', 'sow-option')
      button.disabled = !verdict.allowed
      button.append(el('span', 'sow-name', crop.name))

      if (verdict.allowed) {
        button.append(
          el('span', 'sow-cost', euros(verdict.cost)),
          el('span', `sow-quality ${quality.className}`, quality.text),
        )
        button.title = crop.description
      } else {
        // Le motif est écrit dans le bouton, pas caché dans une infobulle :
        // c'est la question que le joueur se pose au moment précis où il clique.
        button.append(
          el('span', 'sow-cost', '—'),
          el('span', 'sow-blocked', verdict.reason ?? 'Indisponible'),
        )
      }
      button.addEventListener('click', () => this.callbacks.onAction(action))
      // Survoler une culture révèle ses fenêtres sur le ruban : c'est comme ça
      // qu'on apprend le calendrier sans avoir à le mémoriser.
      button.addEventListener('mouseenter', () => this.timeline.showWindowsFor(crop.id))
      button.addEventListener('mouseleave', () => this.timeline.showWindowsFor(null))
      list.append(button)
    }
    this.detailPanel.append(list)
  }

  private sowingQualityLabel(
    cropId: CropId,
    turn: number,
  ): { text: string; className: string } {
    const crop = getCrop(cropId)
    if (turn >= crop.sowing.bestFrom && turn <= crop.sowing.bestTo) {
      return { text: 'Date idéale', className: 'is-good' }
    }
    if (turn < crop.sowing.bestFrom) return { text: 'Un peu tôt', className: 'is-warn' }
    return { text: 'Tardif', className: 'is-warn' }
  }

  private renderCropStatus(campaign: Campaign, state: ParcelState): void {
    const crop = getCrop(state.crop as CropId)
    const economics = economicsOf(crop.id)

    const header = el('div', 'crop-header')
    header.append(el('span', 'crop-name', crop.name), el('span', 'crop-stage', STAGE_LABELS[state.stage] ?? ''))
    this.detailPanel.append(header)
    this.timeline.showWindowsFor(crop.id)

    if (state.harvested) {
      this.detailPanel.append(
        el(
          'p',
          state.harvestedTonnes > 0 ? 'result-good' : 'result-bad',
          state.harvestedTonnes > 0
            ? `Récolté : ${state.harvestedTonnes.toFixed(1)} t, vendues ${euros(state.revenue)}.`
            : 'Parcelle perdue.',
        ),
      )
      return
    }

    const grid = el('div', 'detail-grid')
    grid.append(
      this.stat('Vigueur', `${Math.round(state.vigor * 100)} %`),
      this.stat('Réserve en eau', `${Math.round(state.soilWaterMm)} mm`),
      this.stat('Azote', `${state.nitrogenSplitsDone}/${crop.nitrogenSplits} apports`),
      this.stat('Maladie', `${Math.round(state.diseasePressure * 100)} %`),
      this.stat('Ravageurs', `${Math.round(state.pestPressure * 100)} %`),
      this.stat('Maturité', `${Math.round((state.gdd / crop.physiology.gddMaturity) * 100)} %`),
    )
    this.detailPanel.append(grid)

    // Repère de récolte : l'arbitrage le plus tendu de la campagne.
    if (campaign.turn >= crop.harvest.earliest - 1) {
      const remaining = crop.harvest.latest - campaign.turn
      this.detailPanel.append(
        el(
          'p',
          remaining <= 1 ? 'harvest-urgent' : 'muted',
          remaining <= 0
            ? 'Dernier tour pour récolter.'
            : `Encore ${remaining} tour${remaining > 1 ? 's' : ''} avant la limite de récolte.`,
        ),
      )
    }

    // Le conseil du moment, en tête : la première chose que le joueur doit lire.
    const advice = campaign.advice(state.id)
    if (advice) {
      const box = el('div', `advice-box is-${advice.urgency}`)
      box.append(
        el('span', 'advice-label', advice.urgency === 'urgent' ? 'À faire maintenant' : 'Conseillé'),
        el('span', 'advice-action', advice.label),
        el('span', 'advice-why', advice.why),
      )
      this.detailPanel.append(box)
    }

    // Programme azoté : le « pourquoi » et le « quand » de la fertilisation.
    this.detailPanel.append(el('h3', 'section-title', 'Programme azoté'))
    const plan = el('div', 'nitrogen-plan')
    crop.nitrogenSchedule.forEach((step, index) => {
      const done = index < state.nitrogenSplitsDone
      const isNext = index === state.nitrogenSplitsDone
      const open = campaign.turn >= step.from && campaign.turn <= step.to
      const row = el(
        'div',
        `nitrogen-step${done ? ' is-done' : ''}${isNext ? ' is-next' : ''}${open && !done ? ' is-open' : ''}`,
      )
      const text = el('span', 'nitrogen-step-text')
      text.append(
        el('span', 'nitrogen-step-label', step.label),
        el(
          'span',
          'nitrogen-step-when',
          step.from === step.to
            ? labelOfTurn(step.from)
            : `${labelOfTurn(step.from)} → ${labelOfTurn(step.to)}`,
        ),
      )
      row.append(el('span', 'nitrogen-step-mark', done ? '✓' : String(index + 1)), text)
      plan.append(row)
    })
    this.detailPanel.append(plan)
    this.detailPanel.append(
      el(
        'p',
        'nitrogen-dose',
        `${crop.nitrogenUnits} unités d’azote au total, en ${crop.nitrogenSplits} apport${crop.nitrogenSplits > 1 ? 's' : ''}.`,
      ),
    )
    this.detailPanel.append(el('p', 'nitrogen-note', crop.nitrogenNote))

    this.detailPanel.append(el('h3', 'section-title', 'Interventions'))
    const actions = el('div', 'action-list')

    /**
     * Une intervention proposée. La récolte apparaît deux fois — en régie et par
     * entreprise — parce que c'est le seul arbitrage de la campagne où l'on
     * échange franchement de l'argent contre du temps, et qu'il doit se lire
     * sans avoir à ouvrir un menu.
     */
    const offers: Array<{ action: Action; label: string; note?: string }> = [
      { action: { kind: 'fertiliser', parcelId: state.id }, label: ACTION_LABELS.fertiliser },
      { action: { kind: 'irriguer', parcelId: state.id }, label: ACTION_LABELS.irriguer },
      { action: { kind: 'fongicide', parcelId: state.id }, label: ACTION_LABELS.fongicide },
      { action: { kind: 'insecticide', parcelId: state.id }, label: ACTION_LABELS.insecticide },
      { action: { kind: 'assurer', parcelId: state.id }, label: ACTION_LABELS.assurer },
      {
        action: { kind: 'recolter', parcelId: state.id },
        label: 'Récolter en régie',
        note: 'Votre matériel, votre temps.',
      },
      {
        action: { kind: 'recolter', parcelId: state.id, hired: true },
        label: 'Récolter par entreprise',
        note: 'L’ETA vient avec sa machine : le chantier tient dans la journée.',
      },
    ]

    for (const { action, label, note } of offers) {
      // Une parcelle déjà assurée n'a plus rien à proposer sur ce terrain.
      if (action.kind === 'assurer' && state.insured) continue

      const verdict = campaign.check(action)
      const button = el('button', 'action-button')
      button.disabled = !verdict.allowed
      button.classList.toggle('is-harvest', action.kind === 'recolter')
      button.classList.toggle('is-contractor', action.hired === true)
      // Le conseil ne désigne jamais l'entreprise : c'est un arbitrage
      // financier, pas une recommandation agronomique.
      button.classList.toggle(
        'is-advised',
        advice?.action === action.kind && action.hired !== true,
      )

      // Sur un bouton refusé, un prix n'a pas de sens : « sans frais » à côté
      // d'un refus se lit comme une offre, alors que c'est un mur.
      const days = campaign.daysFor(action)
      button.append(
        el('span', 'action-name', label),
        el(
          'span',
          'action-cost',
          !verdict.allowed ? '' : verdict.cost > 0 ? euros(verdict.cost) : 'sans frais',
        ),
      )
      if (verdict.allowed && days > 0) {
        button.append(el('span', 'action-days', `${days} j de chantier`))
      }

      // Chaque bouton porte sa raison d'être, ou son motif de refus. Rien
      // d'important ne reste caché dans une infobulle.
      const explanation = verdict.allowed
        ? (note ?? ACTION_EXPLANATIONS[action.kind])
        : (verdict.reason ?? 'Indisponible')
      button.append(
        el('span', `action-why${verdict.allowed ? '' : ' is-blocked'}`, explanation),
      )
      button.addEventListener('click', () => this.callbacks.onAction(action))
      actions.append(button)
    }
    this.detailPanel.append(actions)

    if (state.hazardsSuffered.length > 0) {
      this.detailPanel.append(
        el(
          'p',
          'hazard-note',
          `Sinistres subis : ${state.hazardsSuffered.map(hazardName).join(', ').toLowerCase()}. ` +
            'La vigueur perdue ne se rattrape pas.',
        ),
      )
    }

    if (state.insured) {
      this.detailPanel.append(
        el(
          'p',
          'insurance-note',
          `Parcelle assurée — prime de ${euros(state.insurancePremium)}. ` +
            `L’indemnité se règle en fin de campagne, au-delà de ${Math.round(DEDUCTIBLE * 100)} % de perte.`,
        ),
      )
    }

    void economics
  }

  // ------------------------------------------------------------ récapitulatif

  /**
   * Plutôt qu'un journal brut qui défile, on montre ce qui vient de se passer
   * pendant le tour écoulé : le temps qu'il a fait, et les faits marquants
   * regroupés par nature. Le joueur n'a pas à relire l'historique pour
   * comprendre ce qui a changé.
   */
  private renderLog(campaign: Campaign): void {
    this.logPanel.replaceChildren()

    // Au premier tour rien ne s'est encore déroulé : on affiche l'accueil.
    if (campaign.turn === 0) {
      this.logPanel.append(el('h2', 'panel-title', 'La campagne commence'))
      this.logPanel.append(
        el(
          'p',
          'muted',
          'Les sols sortent de moisson. Ouvrez une parcelle pour décider ce que vous y semez, ' +
            'puis passez au tour suivant quand vos décisions sont prises.',
        ),
      )
      return
    }

    const resolved = campaign.turn - 1
    const entries = campaign.log.filter((entry) => entry.turn === resolved)

    this.logPanel.append(
      el('h2', 'panel-title', `Ce qui s'est passé — ${labelOfTurn(resolved)}`),
    )

    // Résumé météo du tour écoulé, en une ligne
    const weather = campaign.weather[resolved]
    if (weather) {
      const summary = el('div', 'digest-weather')
      summary.append(
        el('span', '', `${weather.tempMean.toFixed(0)} °C en moyenne`),
        el('span', '', `${Math.round(weather.rainMm)} mm de pluie`),
      )
      for (const event of weather.events) {
        summary.append(el('span', `event-tag event-${event.id}`, event.label))
      }
      this.logPanel.append(summary)
    }

    const notable = entries.filter((entry) => entry.kind !== 'info')
    const routine = entries.filter((entry) => entry.kind === 'info')

    if (notable.length === 0 && routine.length === 0) {
      this.logPanel.append(el('p', 'muted', 'Rien à signaler. Les cultures suivent leur cours.'))
      return
    }

    // Dégâts et alertes d'abord : c'est ce qui appelle une décision.
    for (const entry of notable) {
      const line = el('div', `log-line log-${entry.kind}`)
      line.append(el('span', '', entry.message))
      this.logPanel.append(line)
    }

    // Les avancées de stade sont regroupées et repliées : utiles, pas urgentes.
    if (routine.length > 0) {
      const group = el('details', 'digest-routine')
      const summary = el('summary', '', `${routine.length} évolution${routine.length > 1 ? 's' : ''} de culture`)
      group.append(summary)
      for (const entry of routine) {
        group.append(el('div', 'log-line log-info', entry.message))
      }
      this.logPanel.append(group)
    }

    if (campaign.log.length > this.lastLogLength) {
      this.logPanel.classList.remove('is-new')
      void this.logPanel.offsetWidth
      this.logPanel.classList.add('is-new')
      this.lastLogLength = campaign.log.length
    }
  }

  setBusy(busy: boolean): void {
    this.advanceButton.disabled = busy
    this.advanceButton.textContent = busy ? 'La saison passe…' : 'Passer au tour suivant'
  }

  /** Dernières entrées ajoutées, pour les retours sonores. */
  static latestEntries(campaign: Campaign, since: number): readonly LogEntry[] {
    return campaign.log.slice(since)
  }

  /** Météo courante exposée pour les effets, évite de la recalculer. */
  static weatherOf(campaign: Campaign): Weather {
    return campaign.currentWeather()
  }
}
