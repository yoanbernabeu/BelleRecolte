/**
 * Ce que le navigateur retient d'une session.
 *
 * Un poste peut planter, un onglet se fermer par erreur. On ne sauvegarde pas
 * l'état du moteur — il est trop vaste et changerait à chaque évolution du jeu
 * — mais le **journal des décisions**. La simulation étant déterministe, rejouer
 * ce journal sur la même graine reconstitue la campagne au geste près.
 */

import type { Action } from '../sim/engine'
import type { InputId } from '../sim/inputs'

const PLAYER_KEY = 'belle-recolte.player.v1'

/**
 * Clé de la session en cours.
 *
 * Exportée parce que le point d'entrée la consulte directement, sans charger ce
 * module : c'est ce test à un octet qui décide s'il faut télécharger tout le
 * dispositif de session ou non.
 */
export const SESSION_KEY = 'belle-recolte.session.v1'

/** Un geste de joueur, rejouable dans l'ordre. */
export type JournalEntry =
  | { readonly t: 'action'; readonly action: Action }
  | { readonly t: 'order'; readonly input: InputId }
  | { readonly t: 'advance' }

export interface SavedSession {
  readonly code: string
  readonly seed: string
  readonly pseudo: string
  readonly startedAt: number
  readonly durationMs: number
  readonly host: boolean
  readonly journal: readonly JournalEntry[]
}

/**
 * Identité du poste, stable d'une session à l'autre.
 *
 * C'est elle qui permet de distinguer un retardataire — refusé — d'un joueur
 * déjà inscrit qui revient après une coupure — accueilli.
 */
export function playerId(): string {
  try {
    const existing = localStorage.getItem(PLAYER_KEY)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    localStorage.setItem(PLAYER_KEY, fresh)
    return fresh
  } catch {
    // Navigateur sans stockage : l'identité ne survivra pas à un rechargement,
    // ce qui coûte la reprise mais n'empêche pas de jouer.
    return crypto.randomUUID()
  }
}

export function saveSession(session: SavedSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // Quota plein ou stockage refusé : on continue sans filet.
  }
}

export function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedSession
    if (typeof parsed?.code !== 'string' || !Array.isArray(parsed.journal)) return null
    return parsed
  } catch {
    return null
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // Sans conséquence : une session périmée est ignorée au chargement.
  }
}

/** Une session reprise a-t-elle encore du temps devant elle ? */
export function isLive(session: SavedSession, now = Date.now()): boolean {
  return now < session.startedAt + session.durationMs
}
