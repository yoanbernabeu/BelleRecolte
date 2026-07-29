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
import type { SessionClient } from './session/client'
import { projectScore } from './session/score'
import { TimerBanner } from './ui/session/timer'
import { RankingScreen } from './ui/session/ranking'
import { clearSession, saveSession, type JournalEntry, type SavedSession } from './session/storage'

/** Ce qui distingue une campagne de session d'une campagne solo. */
export interface SessionContext {
  readonly client: SessionClient
  readonly code: string
  readonly pseudo: string
  readonly host: boolean
  /** Journal à rejouer, quand on reprend une partie après un incident. */
  readonly resume?: readonly JournalEntry[]
}

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

  /** Chrono de session, absent en solo. */
  private timer: TimerBanner | null = null
  private rankingScreen: RankingScreen | null = null
  /** Gestes du joueur, conservés pour pouvoir reprendre après un incident. */
  private journal: JournalEntry[] = []
  private expired = false

  constructor(
    private readonly container: HTMLElement,
    seed: string,
    private readonly onRestart: (seed: string | null) => void,
    private readonly session?: SessionContext,
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
        if (this.expired) return
        if (!this.campaign.orderInput(id)) return
        this.journal.push({ t: 'order', input: id })
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

    if (session?.resume) this.replay(session.resume)

    this.syncAll()
    this.lastLogLength = this.campaign.log.length

    if (session) {
      // En session, le mémo ne s'ouvre pas de lui-même : le chrono tourne déjà,
      // et les règles ont été dites avant le départ. Il reste à un clic.
      this.timer = new TimerBanner(container, session.client, () => this.expire())
    } else {
      // Le briefing pose les contraintes avant la première décision ; le guide
      // les relie ensuite aux endroits de l'écran où elles se lisent. Les deux ne
      // se déclenchent qu'à la toute première partie, et une fois le HUD peint :
      // le guide a besoin des positions réelles des éléments qu'il désigne.
      requestAnimationFrame(() => {
        if (Coach.hasBeenSeen()) return
        new Briefing(container, () => Coach.startIfNeeded(container))
      })
    }
  }

  /**
   * Reconstitue une campagne interrompue par un incident.
   *
   * On ne restaure pas un état sauvegardé — on rejoue les gestes. La simulation
   * étant déterministe, la même graine et la même suite de décisions redonnent
   * la même campagne, au champ près.
   */
  private replay(journal: readonly JournalEntry[]): void {
    for (const step of journal) {
      if (step.t === 'action') this.campaign.apply(step.action)
      else if (step.t === 'order') this.campaign.orderInput(step.input)
      else this.campaign.advance()
    }
    this.journal = [...journal]
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
    if (this.expired) return
    const applied = this.campaign.apply(action)
    if (!applied) return
    this.journal.push({ t: 'action', action })
    this.ambience.cue(action.kind === 'semer' ? 'sow' : action.kind === 'recolter' ? 'harvest' : 'confirm')
    this.syncAll()
  }

  private advance(): void {
    if (this.campaign.finished || this.expired) return
    this.hud.setBusy(true)
    this.campaign.advance()
    this.journal.push({ t: 'advance' })
    this.syncAll()
    this.announceNewEvents()
    this.hud.setBusy(false)
    this.checkpoint()

    if (this.campaign.finished) this.showResult()
  }

  /**
   * Fin de tour, en session : on sauvegarde de quoi reprendre, et on fait
   * remonter un score de secours.
   *
   * Cette remontée n'est montrée à personne — ni aux autres joueurs, ni à
   * l'organisateur. Elle ne sert qu'à une chose : si ce poste disparaissait
   * avant l'échéance, il figurerait quand même au classement, sur sa dernière
   * position connue plutôt que nulle part.
   */
  private checkpoint(): void {
    if (!this.session) return

    const schedule = this.session.client.schedule
    if (schedule) {
      saveSession({
        code: this.session.code,
        seed: this.campaign.seedCode,
        pseudo: this.session.pseudo,
        startedAt: schedule.startedAt,
        durationMs: schedule.durationMs,
        host: this.session.host,
        journal: this.journal,
      } satisfies SavedSession)
    }

    if (!this.campaign.finished) this.session.client.report(projectScore(this.campaign), false)
  }

  /**
   * Le chrono est tombé.
   *
   * La campagne se clôt là où elle en est : rien de plus n'est semé, rien de
   * plus n'est moissonné, mais les charges de l'année entière restent dues.
   */
  private expire(): void {
    if (this.expired) return
    this.expired = true
    this.hud.setBusy(true)
    this.campaign.closeEarly()
    this.syncAll()
    this.showResult()
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

    if (this.session) {
      // Le résultat part une fois, définitif. Les records locaux, eux, restent
      // le journal des campagnes solo : une partie chronométrée n'y entre pas.
      this.session.client.report(projectScore(this.campaign), true)
      this.timer?.dispose()
      this.timer = null
      clearSession()

      this.resultScreen = new ResultScreen(
        this.container,
        this.campaign,
        [],
        () => this.revealOrLeave(),
        () => this.revealOrLeave(),
        {
          singleActionLabel: this.session.host
            ? 'Afficher le classement'
            : 'Terminer',
        },
      )
      return
    }

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

  /**
   * Après son bilan, l'organisateur accède au classement de la salle.
   * Un joueur ordinaire, lui, ne verra jamais celui des autres.
   */
  private revealOrLeave(): void {
    if (!this.session?.host) {
      this.onRestart(null)
      return
    }
    this.resultScreen?.remove()
    this.resultScreen = null
    this.rankingScreen = new RankingScreen(this.container, this.session.client, () =>
      this.onRestart(null),
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
    this.timer?.dispose()
    this.rankingScreen?.dispose()
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
