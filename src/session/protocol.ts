/**
 * Protocole d'une session multijoueur.
 *
 * Ce fichier est la seule chose que le jeu et le serveur de rendez-vous ont en
 * commun. Il ne contient que des types et des constantes : aucune règle
 * agronomique, aucune dépendance au navigateur. Le serveur ne sait rien de la
 * campagne — il distribue une graine, donne le départ, encaisse des résultats.
 * Tout le reste se calcule sur le poste du joueur.
 */

/** Durée d'une session, en millisecondes. Vingt minutes. */
export const SESSION_DURATION_MS = 20 * 60 * 1000

/**
 * Délai laissé aux postes pour faire remonter leur résultat après l'échéance.
 *
 * Au-delà, l'animateur reçoit le classement avec les résultats disponibles :
 * les absents y figurent sur leur dernière remontée connue.
 */
export const RESULT_GRACE_MS = 20 * 1000

/** Longueur du code de session annoncé à la salle. */
export const SESSION_CODE_LENGTH = 4

/**
 * Alphabet du code de session.
 *
 * Sans I, O, 0, 1 : le code se dicte à voix haute devant une salle, et se
 * ressaisit sans hésitation.
 */
export const SESSION_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** État d'un joueur tel que l'animateur le voit. */
export interface PlayerSummary {
  readonly id: string
  readonly pseudo: string
  /** Une connexion est-elle ouverte en ce moment ? */
  readonly connected: boolean
}

/**
 * Résultat d'une campagne, tel qu'il circule sur le réseau.
 *
 * `margin` et `spent` sont déjà projetés par le poste émetteur : ils tiennent
 * compte des charges de structure de la campagne entière, comme si le chrono
 * tombait à cet instant. Le serveur n'a donc aucun calcul à faire.
 */
export interface ScoreReport {
  readonly tonnes: number
  readonly margin: number
  readonly spent: number
  /** Tour atteint au moment de la mesure. */
  readonly turn: number
}

/** Une ligne de classement, telle que l'animateur la reçoit. */
export interface RankingEntry extends ScoreReport {
  readonly id: string
  readonly pseudo: string
  /**
   * `false` quand le poste n'a jamais envoyé son résultat de fin — le joueur
   * est alors classé sur sa dernière remontée connue.
   */
  readonly complete: boolean
}

// ------------------------------------------------------------ client → serveur

export type ClientMessage =
  /** Reprend sa place dans la session : à l'entrée comme après une coupure. */
  | { readonly t: 'hello'; readonly playerId: string; readonly pseudo: string }
  /**
   * Donne le départ. Réservé à l'animateur.
   *
   * `playing` dit s'il prend part à la campagne. Un organisateur resté à la
   * régie ne rendra jamais de résultat : sans cette précision, on l'attendrait
   * indéfiniment et il figurerait au classement avec des zéros.
   */
  | { readonly t: 'start'; readonly playing: boolean }
  /**
   * Remontée silencieuse de fin de tour. Jamais affichée à personne : elle ne
   * sert qu'à classer un poste qui disparaîtrait avant l'échéance.
   */
  | { readonly t: 'progress'; readonly score: ScoreReport }
  /** Résultat définitif, envoyé quand le chrono est tombé. */
  | { readonly t: 'result'; readonly score: ScoreReport }
  /** Réclame le classement. Réservé à l'animateur. */
  | { readonly t: 'ranking' }

// ------------------------------------------------------------ serveur → client

export type ServerMessage =
  /** Salon d'attente : qui est là, et sur quelle campagne. */
  | {
      readonly t: 'lobby'
      readonly code: string
      readonly seed: string
      readonly host: boolean
      readonly players: readonly PlayerSummary[]
      readonly serverNow: number
    }
  /** Le départ est donné — ou la partie était déjà lancée, en cas de reprise. */
  | {
      readonly t: 'started'
      readonly seed: string
      readonly startedAt: number
      readonly durationMs: number
      readonly serverNow: number
    }
  /** Classement, adressé au seul animateur. */
  | { readonly t: 'ranking'; readonly entries: readonly RankingEntry[]; readonly pending: number }
  | { readonly t: 'error'; readonly reason: SessionError }

export type SessionError =
  /** Le code ne correspond à aucune session ouverte. */
  | 'inconnue'
  /** La partie a déjà commencé : la porte est fermée. */
  | 'commencee'
  /** Message réservé à l'animateur. */
  | 'refuse'
  | 'invalide'

/** Explication affichable d'un refus. */
export const ERROR_LABELS: Record<SessionError, string> = {
  inconnue: 'Aucune session ne porte ce code.',
  commencee: 'La partie a déjà commencé : il n’est plus possible de rejoindre.',
  refuse: 'Seul l’animateur peut faire cela.',
  invalide: 'Message incompris par le serveur.',
}

/** Réponse à la création d'une session. */
export interface CreatedSession {
  readonly code: string
}
