/**
 * Orchestrateur.
 *
 * Le seul module qui connaisse à la fois la simulation et le rendu. Il écoute
 * les intentions du HUD, les applique au moteur, puis répercute le nouvel état
 * sur la scène 3D, l'ambiance lumineuse et le mixage sonore.
 */

import * as THREE from 'three'
import { Ambience } from './audio/ambience'
import { CropLayer } from './render/cropLayer'
import { appearanceFor } from './render/cropVisuals'
import { moodFor } from './render/mood'
import { Sky } from './render/sky'
import { Viewport } from './render/viewport'
import { Precipitation, type PrecipitationKind } from './render/weatherFx'
import { World } from './render/world'
import { Campaign, type Action } from './sim/engine'
import { getSoil } from './sim/soils'
import { Hud } from './ui/hud'
import { ResultScreen } from './ui/screens'
import { saveRecord } from './ui/records'
import { Briefing, Coach } from './ui/onboarding'
import { AlertStack } from './ui/alerts'

export class Game {
  private readonly viewport: Viewport
  private readonly sky: Sky
  private readonly world: World
  private readonly precipitation: Precipitation
  private readonly ambience = new Ambience()
  private readonly layers: CropLayer[]
  private readonly hud: Hud
  private readonly alerts: AlertStack
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()

  private campaign: Campaign
  private hovered: number | null = null
  private resultScreen: ResultScreen | null = null
  private lastLogLength = 0
  private windStrength = 0.3

  constructor(
    private readonly container: HTMLElement,
    seed: string,
    private readonly onRestart: (seed: string | null) => void,
  ) {
    this.campaign = new Campaign(seed)

    this.viewport = new Viewport(container)
    this.sky = new Sky(this.viewport.scene)
    this.world = new World(this.viewport.scene)
    this.precipitation = new Precipitation(this.viewport.scene)

    this.layers = this.world.parcels.map((visual) => {
      const layer = new CropLayer(visual.definition, getSoil(visual.definition.soil).color)
      this.viewport.scene.add(layer.mesh)
      return layer
    })

    this.hud = new Hud(container, {
      onAction: (action) => this.handleAction(action),
      onAdvance: () => this.advance(),
      onSelectParcel: (id) => {
        this.focusParcel(id)
        // Sans ce rafraîchissement, le panneau de détail n'apparaîtrait qu'au
        // rendu suivant : la parcelle serait sélectionnée sans rien afficher.
        this.syncHud()
      },
      onToggleAudio: () => void this.toggleAudio(),
      onOrderInput: (id) => {
        if (!this.campaign.orderInput(id)) return
        this.ambience.cue('confirm')
        this.syncAll()
      },
      onShowBriefing: () => this.showBriefing(),
    })

    this.alerts = new AlertStack(container, (parcelId) => {
      this.hud.select(parcelId)
      this.focusParcel(parcelId)
      this.syncHud()
    })

    this.bindPointer()
    this.viewport.onFrame((delta, elapsed) => this.frame(delta, elapsed))
    this.viewport.start()

    this.syncAll()
    this.lastLogLength = this.campaign.log.length

    // Le briefing pose les contraintes avant la première décision ; le guide
    // les relie ensuite aux endroits de l'écran où elles se lisent. Les deux ne
    // se déclenchent qu'à la toute première partie, et une fois le HUD peint :
    // le guide a besoin des positions réelles des éléments qu'il désigne.
    requestAnimationFrame(() => {
      if (Coach.hasBeenSeen()) return
      new Briefing(container, () => Coach.startIfNeeded(container))
    })
  }

  /** Réaffiche le mémo de campagne à la demande. */
  private showBriefing(): void {
    new Briefing(this.container, () => undefined)
  }

  // ------------------------------------------------------------ entrées

  private bindPointer(): void {
    const canvas = this.viewport.canvas

    canvas.addEventListener('pointermove', (event) => {
      const rect = canvas.getBoundingClientRect()
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      this.hovered = this.pickParcel()
      canvas.style.cursor = this.hovered === null ? 'grab' : 'pointer'
      this.world.setHighlight(this.hovered, this.hud.selected)
    })

    canvas.addEventListener('pointerleave', () => {
      this.hovered = null
      this.world.setHighlight(null, this.hud.selected)
    })

    // On distingue un clic d'un glissement de caméra : sans ça, faire pivoter
    // la vue sélectionnerait une parcelle à chaque relâchement.
    let downAt: { x: number; y: number } | null = null
    canvas.addEventListener('pointerdown', (event) => {
      downAt = { x: event.clientX, y: event.clientY }
    })
    canvas.addEventListener('pointerup', (event) => {
      if (!downAt) return
      const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y)
      downAt = null
      if (moved > 6) return
      const picked = this.pickParcel()
      const next = picked === this.hud.selected ? null : picked
      this.hud.select(next)
      this.focusParcel(next)
      this.syncHud()
    })

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.hud.select(null)
        this.world.setHighlight(this.hovered, null)
        this.syncHud()
      }
      if (event.key === ' ' && !this.campaign.finished) {
        event.preventDefault()
        this.advance()
      }
    })
  }

  private pickParcel(): number | null {
    this.raycaster.setFromCamera(this.pointer, this.viewport.camera)
    const targets: THREE.Object3D[] = [
      ...this.world.parcels.map((p) => p.soilMesh),
      ...this.layers.map((l) => l.mesh),
    ]
    const hits = this.raycaster.intersectObjects(targets, false)
    for (const hit of hits) {
      const id = hit.object.userData['parcelId']
      if (typeof id === 'number') return id
    }
    return null
  }

  private focusParcel(id: number | null): void {
    this.world.setHighlight(this.hovered, id)
    if (id === null) return
    const visual = this.world.parcelAt(id)
    if (visual) this.viewport.focusOn(visual.center.clone(), 62)
  }

  // ------------------------------------------------------------ jeu

  private handleAction(action: Action): void {
    const applied = this.campaign.apply(action)
    if (!applied) return
    this.ambience.cue(action.kind === 'semer' ? 'sow' : action.kind === 'recolter' ? 'harvest' : 'confirm')
    this.syncAll()
  }

  private advance(): void {
    if (this.campaign.finished) return
    this.hud.setBusy(true)
    this.campaign.advance()
    this.syncAll()
    this.announceNewEvents()
    this.hud.setBusy(false)

    if (this.campaign.finished) this.showResult()
  }

  private announceNewEvents(): void {
    const fresh = this.campaign.log.slice(this.lastLogLength)
    this.lastLogLength = this.campaign.log.length
    if (fresh.some((entry) => entry.kind === 'damage')) {
      this.ambience.cue('warning')
    }
    // Les alertes remontent après la résolution : elles décrivent l'état dans
    // lequel le joueur reprend la main, pas celui qu'il vient de quitter. Les
    // sinistres passent devant — ce qui vient de tomber prime sur ce qui
    // menace de tomber.
    this.alerts.show(
      this.campaign.finished
        ? []
        : [...this.campaign.strikes(), ...this.campaign.dangers()],
    )
  }

  private showResult(): void {
    const result = this.campaign.result()
    const records = saveRecord({
      seed: this.campaign.seedCode,
      tonnes: result.totalTonnes,
      margin: result.margin,
      yearName: result.yearName,
      date: new Date().toISOString(),
    })
    this.resultScreen = new ResultScreen(
      this.container,
      this.campaign,
      records,
      () => this.onRestart(this.campaign.seedCode),
      () => this.onRestart(null),
    )
  }

  // ------------------------------------------------------------ synchro

  private syncAll(): void {
    this.syncHud()
    this.syncScene()
  }

  private syncHud(): void {
    this.hud.render(this.campaign)
  }

  private syncScene(): void {
    for (const layer of this.layers) {
      layer.setAppearance(appearanceFor(this.campaign.parcel(layer.parcelId)))
    }

    const weather = this.campaign.currentWeather()
    const mood = moodFor(this.campaign.turn, weather)
    this.sky.apply(mood.sky)
    this.ambience.setMood(mood.ambience)
    this.windStrength = mood.windStrength

    // La grêle prime sur la pluie, la neige prime sur tout quand il gèle.
    const hail = weather.events.some((event) => event.id === 'grele')
    let kind: PrecipitationKind = 'pluie'
    let intensity = mood.rainIntensity
    if (mood.snowIntensity > 0.05) {
      kind = 'neige'
      intensity = mood.snowIntensity
    } else if (hail) {
      kind = 'grele'
      intensity = Math.max(0.55, mood.rainIntensity)
    }
    this.precipitation.set(kind, intensity)
  }

  private frame(delta: number, elapsed: number): void {
    this.sky.update(elapsed)

    // Les couverts s'éclairent avec les lumières de la scène : rien à leur
    // transmettre à la main.
    for (const layer of this.layers) {
      layer.update(delta, elapsed, this.windStrength)
    }

    this.precipitation.update(delta, elapsed, this.viewport.controls.target, this.windStrength)
  }

  // ------------------------------------------------------------ audio

  private async toggleAudio(): Promise<void> {
    if (this.ambience.isEnabled) {
      await this.ambience.disable()
      this.hud.setAudioEnabled(false)
      return
    }
    await this.ambience.enable()
    this.ambience.setMood(moodFor(this.campaign.turn, this.campaign.currentWeather()).ambience)
    this.hud.setAudioEnabled(true)
  }

  dispose(): void {
    this.alerts.dispose()
    void this.ambience.disable()
    for (const layer of this.layers) layer.dispose()
    this.precipitation.dispose()
    this.world.dispose()
    this.sky.dispose()
    this.viewport.dispose()
    this.hud.root.remove()
    this.resultScreen?.remove()
  }
}
