/**
 * Le poste, vu depuis la salle.
 *
 * Ce client ne fait que trois choses : tenir une connexion vivante jusqu'au bout
 * des vingt minutes, savoir quelle heure il est pour tout le monde, et faire
 * remonter les scores. Toute la campagne, elle, se joue en local — le réseau
 * n'entre jamais dans la simulation.
 */

import {
  ERROR_LABELS,
  SESSION_DURATION_MS,
  type ClientMessage,
  type CreatedSession,
  type PlayerSummary,
  type RankingEntry,
  type ScoreReport,
  type ServerMessage,
} from './protocol'

/**
 * Adresse du point de rendez-vous.
 *
 * Renseignée à la compilation par `VITE_SESSION_SERVER`. Le jeu reste hébergé
 * en statique : seul ce serveur-là est ailleurs.
 */
// `||` et non `??` : une variable définie mais vide — le cas d'un dépôt sans
// surcharge configurée — doit retomber sur l'adresse publiée, pas produire une
// URL vide qui casserait toutes les sessions.
export const SESSION_SERVER: string =
  (import.meta.env['VITE_SESSION_SERVER'] as string | undefined) ||
  'https://belle-recolte-sessions.ybernabeu.workers.dev'

export type SessionPhase = 'connexion' | 'salon' | 'jeu' | 'termine'

export interface SessionView {
  readonly phase: SessionPhase
  readonly code: string
  readonly seed: string
  readonly host: boolean
  readonly players: readonly PlayerSummary[]
  readonly ranking: readonly RankingEntry[]
  /** Nombre de postes dont le résultat définitif manque encore. */
  readonly pending: number
  readonly error: string | null
  /** Vrai tant que la connexion est perdue et qu'on cherche à revenir. */
  readonly reconnecting: boolean
}

/** Crée une session et renvoie le code à annoncer à la salle. */
export async function createSession(
  seed: string,
  hostId: string,
  durationMs: number = SESSION_DURATION_MS,
  server: string = SESSION_SERVER,
): Promise<string> {
  const response = await fetch(`${server}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seed, hostId, durationMs }),
  })
  if (!response.ok) throw new Error('Le serveur de sessions n’a pas répondu.')
  const created = (await response.json()) as CreatedSession
  return created.code
}

const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000]

export class SessionClient {
  private socket: WebSocket | null = null
  private attempts = 0
  private closing = false
  /** Écart entre l'horloge du serveur et celle de ce poste, en millisecondes. */
  private clockOffset = 0
  private startedAt: number | null = null
  private durationMs = SESSION_DURATION_MS
  private lastScore: { score: ScoreReport; final: boolean } | null = null
  private acknowledged = false

  private view: SessionView = {
    phase: 'connexion',
    code: '',
    seed: '',
    host: false,
    players: [],
    ranking: [],
    pending: 0,
    error: null,
    reconnecting: false,
  }

  private readonly listeners = new Set<(view: SessionView) => void>()

  constructor(
    private readonly code: string,
    private readonly playerId: string,
    private readonly pseudo: string,
    private readonly server: string = SESSION_SERVER,
  ) {
    this.view = { ...this.view, code }
  }

  // ------------------------------------------------------------- abonnements

  onChange(listener: (view: SessionView) => void): () => void {
    this.listeners.add(listener)
    listener(this.view)
    return () => this.listeners.delete(listener)
  }

  get state(): SessionView {
    return this.view
  }

  private patch(changes: Partial<SessionView>): void {
    this.view = { ...this.view, ...changes }
    for (const listener of this.listeners) listener(this.view)
  }

  // -------------------------------------------------------------- connexion

  connect(): void {
    if (this.closing) return

    const url = this.server.replace(/^http/, 'ws')
    const socket = new WebSocket(`${url}/sessions/${this.code}/ws`)
    this.socket = socket

    socket.addEventListener('open', () => {
      this.attempts = 0
      this.patch({ reconnecting: false })
      this.send({ t: 'hello', playerId: this.playerId, pseudo: this.pseudo })
      // Une coupure a pu survenir entre deux tours : on repose le dernier score
      // connu, sans quoi la remontée de secours aurait un trou.
      if (this.lastScore) this.report(this.lastScore.score, this.lastScore.final)
    })

    socket.addEventListener('message', (event) => {
      try {
        this.receive(JSON.parse(String(event.data)) as ServerMessage)
      } catch {
        // Message illisible : rien à faire d'utile, on attend le suivant.
      }
    })

    socket.addEventListener('close', () => this.retry())
    socket.addEventListener('error', () => socket.close())
  }

  private retry(): void {
    if (this.closing || this.view.phase === 'termine') return
    this.patch({ reconnecting: true })
    const delay = RETRY_DELAYS_MS[Math.min(this.attempts, RETRY_DELAYS_MS.length - 1)] ?? 8000
    this.attempts += 1
    window.setTimeout(() => this.connect(), delay)
  }

  private receive(message: ServerMessage): void {
    switch (message.t) {
      case 'lobby':
        this.clockOffset = message.serverNow - Date.now()
        this.patch({
          phase: 'salon',
          code: message.code || this.code,
          seed: message.seed,
          host: message.host,
          players: message.players,
          error: null,
        })
        return

      case 'started':
        this.clockOffset = message.serverNow - Date.now()
        this.startedAt = message.startedAt
        this.durationMs = message.durationMs
        this.patch({ phase: 'jeu', seed: message.seed, error: null })
        return

      case 'ranking':
        this.patch({ ranking: message.entries, pending: message.pending })
        return

      case 'error':
        this.patch({ error: ERROR_LABELS[message.reason] })
        // Un refus est définitif : inutile de s'acharner à revenir.
        if (message.reason === 'commencee' || message.reason === 'inconnue') this.dispose()
        return
    }
  }

  // ----------------------------------------------------------------- actions

  /**
   * Donne le départ. Sans effet si ce poste n'est pas celui de l'animateur.
   *
   * `playing` doit dire la vérité : un organisateur annoncé joueur mais resté à
   * la régie serait attendu jusqu'à l'échéance avant toute clôture.
   */
  start(playing: boolean): void {
    this.send({ t: 'start', playing })
  }

  /**
   * Fait remonter un score.
   *
   * Les remontées de tour ne sont jamais affichées à quiconque : elles servent
   * uniquement à classer un poste qui disparaîtrait avant l'échéance.
   */
  report(score: ScoreReport, final: boolean): void {
    this.lastScore = { score, final }
    if (final) this.acknowledged = true
    this.send(final ? { t: 'result', score } : { t: 'progress', score })
  }

  /** Réclame le classement. Réservé à l'animateur. */
  requestRanking(): void {
    this.send({ t: 'ranking' })
  }

  /** A-t-on déjà transmis un résultat définitif ? */
  get hasReported(): boolean {
    return this.acknowledged
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify(message))
  }

  // -------------------------------------------------------------------- temps

  /** L'heure qu'il est pour toute la salle. */
  now(): number {
    return Date.now() + this.clockOffset
  }

  /** Millisecondes restantes, `null` tant que le départ n'a pas été donné. */
  remainingMs(): number | null {
    if (this.startedAt === null) return null
    return Math.max(0, this.startedAt + this.durationMs - this.now())
  }

  get schedule(): { startedAt: number; durationMs: number } | null {
    return this.startedAt === null
      ? null
      : { startedAt: this.startedAt, durationMs: this.durationMs }
  }

  /**
   * Reprend une session déjà commencée, sans attendre le message du serveur.
   * C'est ce qui permet au chrono de s'afficher juste après un rechargement.
   */
  resume(startedAt: number, durationMs: number): void {
    this.startedAt = startedAt
    this.durationMs = durationMs
    this.patch({ phase: 'jeu' })
  }

  finish(): void {
    this.patch({ phase: 'termine' })
  }

  dispose(): void {
    this.closing = true
    this.socket?.close()
    this.socket = null
    this.listeners.clear()
  }
}
