/**
 * Point de rendez-vous des sessions de Belle Récolte.
 *
 * Ce serveur ne joue pas. Il ne connaît ni les cultures, ni la météo, ni le
 * moindre euro de charge : la simulation tourne intégralement dans le
 * navigateur de chaque joueur, comme en solo. Il ne fait que quatre choses —
 * distribuer une graine commune, donner le départ à la même seconde pour tout
 * le monde, encaisser les résultats, et les rendre à l'animateur.
 *
 * Une Durable Object par session, adressée par le code annoncé à la salle.
 */

import { DurableObject } from 'cloudflare:workers'
import {
  RESULT_GRACE_MS,
  SESSION_CODE_ALPHABET,
  SESSION_CODE_LENGTH,
  SESSION_DURATION_MS,
  type ClientMessage,
  type CreatedSession,
  type PlayerSummary,
  type RankingEntry,
  type ScoreReport,
  type ServerMessage,
  type SessionError,
} from '../../src/session/protocol'

export interface Env {
  readonly SESSIONS: DurableObjectNamespace<SessionRoom>
}

/** Ce que le WebSocket retient de son propriétaire, y compris après hibernation. */
interface SocketOwner {
  readonly playerId: string
}

/** Déclaré en `type` et non en `interface` : le SDK SQLite exige un index de clés. */
type PlayerRow = {
  id: string
  pseudo: string
  tonnes: number
  margin: number
  spent: number
  turn: number
  final: number
}

const CODE_ATTEMPTS = 12

export class SessionRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `)
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS players (
          id TEXT PRIMARY KEY,
          pseudo TEXT NOT NULL,
          joined INTEGER NOT NULL,
          tonnes REAL NOT NULL DEFAULT 0,
          margin REAL NOT NULL DEFAULT 0,
          spent REAL NOT NULL DEFAULT 0,
          turn INTEGER NOT NULL DEFAULT 0,
          final INTEGER NOT NULL DEFAULT 0,
          -- L'organisateur resté à la régie : il ne rend rien et ne se classe
          -- pas. Sans quoi on l'attendrait pour clore la session.
          spectator INTEGER NOT NULL DEFAULT 0
        )
      `)

      // Sessions créées avant l'ajout de la colonne : `CREATE TABLE IF NOT
      // EXISTS` ne touche pas une table déjà là. L'ajout échoue si elle existe
      // déjà, et c'est très bien.
      try {
        this.ctx.storage.sql.exec(
          'ALTER TABLE players ADD COLUMN spectator INTEGER NOT NULL DEFAULT 0',
        )
      } catch {
        // Colonne déjà présente.
      }
    })
  }

  // --------------------------------------------------------------- ouverture

  /**
   * Réserve ce code pour une nouvelle session.
   *
   * Renvoie `false` si le code est déjà pris : le Worker en tire un autre. Une
   * Durable Object existe toujours en droit, c'est cette table qui dit si elle
   * est occupée en fait.
   */
  claim(seed: string, durationMs: number, hostId: string): boolean {
    if (this.meta('seed') !== null) return false
    this.setMeta('seed', seed)
    this.setMeta('durationMs', String(durationMs))
    this.setMeta('hostId', hostId)
    return true
  }

  async fetch(_request: Request): Promise<Response> {
    if (this.meta('seed') === null) return new Response('session inconnue', { status: 404 })

    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  // ---------------------------------------------------------------- messages

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let message: ClientMessage
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
    } catch {
      return this.refuse(ws, 'invalide')
    }

    switch (message.t) {
      case 'hello':
        return this.welcome(ws, message.playerId, message.pseudo)
      case 'start':
        return this.begin(ws, message.playing !== false)
      case 'progress':
        return this.record(ws, message.score, false)
      case 'result':
        return this.record(ws, message.score, true)
      case 'ranking':
        return this.sendRanking(ws)
      default:
        return this.refuse(ws, 'invalide')
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    // Le joueur reste inscrit : il peut revenir, et son résultat compte quoi
    // qu'il arrive. Seule la pastille « connecté » du salon change.
    this.broadcastLobby()
    void ws
  }

  /**
   * Entrée dans la session, ou retour après une coupure.
   *
   * La porte se ferme au départ — mais seulement pour les inconnus. Un joueur
   * déjà inscrit qui revient après avoir fermé son navigateur par erreur
   * retrouve sa place, et le chrono qui n'a pas cessé de tourner.
   */
  private welcome(ws: WebSocket, playerId: string, pseudo: string): void {
    const known = this.player(playerId) !== null
    const startedAt = this.startedAt()

    if (!known && startedAt !== null) return this.refuse(ws, 'commencee')

    if (!known) {
      this.ctx.storage.sql.exec(
        'INSERT INTO players (id, pseudo, joined) VALUES (?, ?, ?)',
        playerId,
        pseudo.slice(0, 24),
        Date.now(),
      )
    }

    ws.serializeAttachment({ playerId } satisfies SocketOwner)

    if (startedAt === null) {
      this.send(ws, this.lobbyFor(playerId))
      this.broadcastLobby()
      return
    }

    this.send(ws, {
      t: 'started',
      seed: this.meta('seed') ?? '',
      startedAt,
      durationMs: this.durationMs(),
      serverNow: Date.now(),
    })
  }

  /** Le départ, donné par l'animateur et daté par le serveur. */
  private begin(ws: WebSocket, hostPlays: boolean): void {
    if (!this.isHost(ws)) return this.refuse(ws, 'refuse')
    if (this.startedAt() !== null) return

    if (!hostPlays) {
      const hostId = this.meta('hostId')
      if (hostId) {
        this.ctx.storage.sql.exec('UPDATE players SET spectator = 1 WHERE id = ?', hostId)
      }
    }

    const startedAt = Date.now()
    this.setMeta('startedAt', String(startedAt))

    // De quoi laisser aux postes le temps de faire remonter leur résultat, puis
    // de servir le classement à l'animateur même si l'un d'eux s'est volatilisé.
    void this.ctx.storage.setAlarm(startedAt + this.durationMs() + RESULT_GRACE_MS)

    const message: ServerMessage = {
      t: 'started',
      seed: this.meta('seed') ?? '',
      startedAt,
      durationMs: this.durationMs(),
      serverNow: startedAt,
    }
    for (const socket of this.ctx.getWebSockets()) this.send(socket, message)
  }

  /**
   * Enregistre un score.
   *
   * Les remontées de fin de tour écrasent la précédente — une seule ligne par
   * joueur, jamais rediffusée à personne. Un résultat définitif, lui, ne se
   * laisse plus écraser par une remontée en retard.
   */
  private record(ws: WebSocket, score: ScoreReport, final: boolean): void {
    const owner = this.owner(ws)
    if (!owner) return this.refuse(ws, 'invalide')

    const existing = this.player(owner.playerId)
    if (!existing) return this.refuse(ws, 'invalide')
    if (existing.final === 1 && !final) return

    this.ctx.storage.sql.exec(
      'UPDATE players SET tonnes = ?, margin = ?, spent = ?, turn = ?, final = ? WHERE id = ?',
      score.tonnes,
      score.margin,
      score.spent,
      score.turn,
      final ? 1 : 0,
      owner.playerId,
    )

    if (final && this.pendingCount() === 0) this.pushRankingToHost()
  }

  /** Échéance dépassée : l'animateur reçoit ce qui est arrivé. */
  async alarm(): Promise<void> {
    this.pushRankingToHost()
  }

  // -------------------------------------------------------------- classement

  private sendRanking(ws: WebSocket): void {
    if (!this.isHost(ws)) return this.refuse(ws, 'refuse')
    this.send(ws, this.ranking())
  }

  private pushRankingToHost(): void {
    const hostId = this.meta('hostId')
    if (!hostId) return
    const payload = this.ranking()
    for (const socket of this.ctx.getWebSockets()) {
      if (this.owner(socket)?.playerId === hostId) this.send(socket, payload)
    }
  }

  /**
   * Les résultats bruts, sans tri ni verdict.
   *
   * Le classement lui-même — deux tableaux, et la bascule sur les frais engagés
   * quand personne n'a rien récolté — se décide côté animateur. Ce serveur n'a
   * pas à connaître les règles du jeu.
   */
  private ranking(): ServerMessage {
    const rows = this.ctx.storage.sql
      .exec<PlayerRow>(
        'SELECT id, pseudo, tonnes, margin, spent, turn, final FROM players WHERE spectator = 0',
      )
      .toArray()

    const entries: RankingEntry[] = rows.map((row) => ({
      id: row.id,
      pseudo: row.pseudo,
      tonnes: row.tonnes,
      margin: row.margin,
      spent: row.spent,
      turn: row.turn,
      complete: row.final === 1,
    }))

    return { t: 'ranking', entries, pending: this.pendingCount() }
  }

  /** Combien de joueurs doivent encore leur résultat — spectateurs exclus. */
  private pendingCount(): number {
    const row = this.ctx.storage.sql
      .exec<{ n: number }>('SELECT COUNT(*) AS n FROM players WHERE final = 0 AND spectator = 0')
      .one()
    return row.n
  }

  // ------------------------------------------------------------------ menues

  private lobbyFor(playerId: string): ServerMessage {
    const players = this.ctx.storage.sql
      .exec<{ id: string; pseudo: string }>('SELECT id, pseudo FROM players ORDER BY joined')
      .toArray()

    const connected = new Set(
      this.ctx.getWebSockets().map((socket) => this.owner(socket)?.playerId),
    )

    const summaries: PlayerSummary[] = players.map((player) => ({
      id: player.id,
      pseudo: player.pseudo,
      connected: connected.has(player.id),
    }))

    return {
      t: 'lobby',
      code: this.meta('code') ?? '',
      seed: this.meta('seed') ?? '',
      host: this.meta('hostId') === playerId,
      players: summaries,
      serverNow: Date.now(),
    }
  }

  private broadcastLobby(): void {
    if (this.startedAt() !== null) return
    for (const socket of this.ctx.getWebSockets()) {
      const owner = this.owner(socket)
      if (owner) this.send(socket, this.lobbyFor(owner.playerId))
    }
  }

  private owner(ws: WebSocket): SocketOwner | null {
    const attachment = ws.deserializeAttachment() as SocketOwner | null
    return attachment ?? null
  }

  private isHost(ws: WebSocket): boolean {
    const owner = this.owner(ws)
    return owner !== null && owner.playerId === this.meta('hostId')
  }

  private player(id: string): PlayerRow | null {
    const rows = this.ctx.storage.sql
      .exec<PlayerRow>('SELECT id, pseudo, tonnes, margin, spent, turn, final FROM players WHERE id = ?', id)
      .toArray()
    return rows[0] ?? null
  }

  private startedAt(): number | null {
    const raw = this.meta('startedAt')
    return raw === null ? null : Number(raw)
  }

  private durationMs(): number {
    const raw = this.meta('durationMs')
    return raw === null ? SESSION_DURATION_MS : Number(raw)
  }

  private meta(key: string): string | null {
    const rows = this.ctx.storage.sql
      .exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)
      .toArray()
    return rows[0]?.value ?? null
  }

  setMeta(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = ?',
      key,
      value,
      value,
    )
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message))
    } catch {
      // Connexion déjà refermée : le joueur reviendra, ou pas.
    }
  }

  private refuse(ws: WebSocket, reason: SessionError): void {
    this.send(ws, { t: 'error', reason })
  }
}

// ------------------------------------------------------------------- routage

function sessionCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SESSION_CODE_LENGTH))
  let code = ''
  for (const byte of bytes) code += SESSION_CODE_ALPHABET[byte % SESSION_CODE_ALPHABET.length]
  return code
}

function cors(response: Response): Response {
  response.headers.set('Access-Control-Allow-Origin', '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'content-type')
  return response
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }))

    // Création : le Worker cherche un code libre et le rend à l'animateur.
    if (request.method === 'POST' && url.pathname === '/sessions') {
      const body = (await request.json().catch(() => null)) as {
        seed?: string
        hostId?: string
        durationMs?: number
      } | null

      if (!body?.seed || !body.hostId) {
        return cors(new Response('graine ou animateur manquant', { status: 400 }))
      }

      const duration = Number(body.durationMs) > 0 ? Number(body.durationMs) : SESSION_DURATION_MS

      for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
        const code = sessionCode()
        const stub = env.SESSIONS.getByName(code)
        if (await stub.claim(body.seed, duration, body.hostId)) {
          await stub.setMeta('code', code)
          return cors(Response.json({ code } satisfies CreatedSession))
        }
      }

      return cors(new Response('aucun code disponible', { status: 503 }))
    }

    // Connexion : /sessions/ABCD/ws
    const match = /^\/sessions\/([A-Za-z0-9]+)\/ws$/.exec(url.pathname)
    const code = match?.[1]
    if (code && request.headers.get('Upgrade') === 'websocket') {
      return env.SESSIONS.getByName(code.toUpperCase()).fetch(request)
    }

    return cors(new Response('Belle Récolte — serveur de sessions', { status: 404 }))
  },
} satisfies ExportedHandler<Env>
