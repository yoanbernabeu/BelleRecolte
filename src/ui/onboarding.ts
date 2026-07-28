/**
 * Apprentissage du jeu.
 *
 * Deux temps distincts. D'abord un briefing : ce qu'on a en main, ce qui part
 * tout seul, ce qui va manquer, ce qui peut tomber. Ensuite des repères posés
 * sur l'écran, pour relier chaque contrainte à l'endroit où elle se lit.
 *
 * Le briefing existe parce que les contraintes de cette campagne ne se
 * découvrent pas en jouant : un joueur qui apprend en février que son stock
 * d'azote ne couvre pas ses huit parcelles a déjà perdu la partie, et il n'a
 * aucun moyen de savoir que c'était une décision d'août.
 */

import { STARTING_BUDGET, STRUCTURE_COST_PER_HA, OVERDRAFT_LIMIT } from '../sim/economics'
import { TOTAL_AREA_HA } from '../sim/farm'
import { INITIAL_ORDER_COST, INPUTS } from '../sim/inputs'
import { TURNS_PER_CAMPAIGN } from '../sim/calendar'

const SEEN_KEY = 'belle-recolte.coach-seen.v1'

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

// ---------------------------------------------------------------- briefing

interface BriefingCard {
  readonly mark: string
  readonly title: string
  readonly lines: readonly string[]
}

function briefingCards(): readonly BriefingCard[] {
  const structure = Math.round((STRUCTURE_COST_PER_HA * TOTAL_AREA_HA) / TURNS_PER_CAMPAIGN)
  return [
    {
      mark: '💰',
      title: 'Ce que vous avez',
      lines: [
        `${euros(STARTING_BUDGET)} de trésorerie et ${TOTAL_AREA_HA} hectares.`,
        `La commande d’intrants de l’été est déjà partie : ${euros(INITIAL_ORDER_COST)}.`,
      ],
    },
    {
      mark: '📉',
      title: 'Ce qui part tout seul',
      lines: [
        `${euros(structure)} par quinzaine de charges de structure.`,
        'Fermage, matériel, cotisations : ça tombe même sur une parcelle retournée.',
        `Les recettes n’arrivent qu’en juillet. Entre-temps, la banque suit jusqu’à ${euros(OVERDRAFT_LIMIT)}.`,
      ],
    },
    {
      mark: '🏚️',
      title: 'Ce qui va manquer',
      lines: [
        `${INPUTS.azote.initialStock} unités d’azote en hangar, pour un besoin d’environ 15 000.`,
        'Vous ne pourrez pas tout conduire à l’optimum. Choisissez vos parcelles.',
        'Recommander coûte plus cher et met un tour à arriver.',
      ],
    },
    {
      mark: '⛈️',
      title: 'Ce qui peut tomber',
      lines: [
        'La grêle, les sangliers, les limaces : rien de tout ça n’est dans les prévisions.',
        'Chaque parcelle peut être assurée dans les deux tours qui suivent son semis.',
      ],
    },
  ]
}

/**
 * Le briefing d'ouverture. Une carte, quatre choses à savoir, un bouton.
 * Il peut être rouvert à tout moment depuis le bandeau : c'est un mémo autant
 * qu'une introduction.
 */
export class Briefing {
  private readonly root: HTMLElement

  constructor(parent: HTMLElement, private readonly onClose: () => void) {
    this.root = el('div', 'overlay briefing')

    const card = el('div', 'overlay-card briefing-card')
    card.append(el('p', 'briefing-eyebrow', 'Fin août · la campagne commence'))
    card.append(el('h1', 'title', 'Quinze mois devant vous'))
    card.append(
      el(
        'p',
        'briefing-lede',
        'Vous reprenez l’exploitation au lendemain de la moisson. Tout est à décider : ' +
          'ce que vous semez, ce que vous traitez, ce que vous assurez — et ce que vous ' +
          'laissez de côté, parce qu’il n’y aura pas assez pour tout le monde.',
      ),
    )

    const grid = el('div', 'briefing-grid')
    for (const { mark, title, lines } of briefingCards()) {
      const tile = el('article', 'briefing-tile')
      const head = el('div', 'briefing-tile-head')
      head.append(el('span', 'briefing-mark', mark), el('h2', 'briefing-tile-title', title))
      tile.append(head)
      const list = el('ul', 'briefing-list')
      for (const line of lines) list.append(el('li', '', line))
      tile.append(list)
      grid.append(tile)
    }
    card.append(grid)

    card.append(
      el(
        'p',
        'briefing-foot',
        'Rien ne bouge tant que vous ne passez pas au tour suivant. Prenez votre temps.',
      ),
    )

    const button = el('button', 'primary-button briefing-go', 'Ouvrir la ferme')
    button.addEventListener('click', () => this.close())
    card.append(button)

    this.root.append(card)
    parent.append(this.root)

    // Échapper ferme aussi : un mémo qu'on ne peut pas refermer vite est une gêne.
    window.addEventListener('keydown', this.onKey)
  }

  private onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.close()
  }

  private close(): void {
    window.removeEventListener('keydown', this.onKey)
    this.root.classList.add('is-hidden')
    window.setTimeout(() => this.root.remove(), 320)
    this.onClose()
  }
}

// ---------------------------------------------------------------- coach

interface CoachStep {
  /** Sélecteur de l'élément à mettre en avant. */
  readonly target: string
  readonly title: string
  readonly body: string
  /** Position de la bulle par rapport à la cible. */
  readonly placement: 'below' | 'above' | 'right' | 'left'
}

const STEPS: readonly CoachStep[] = [
  {
    target: '.timeline',
    title: 'Le ruban de campagne',
    body:
      'Toute la campagne tient ici : les quatre saisons, et les vingt-sept tours. Le repère clair ' +
      'indique où vous en êtes. Survolez une culture dans le panneau de droite et son calendrier ' +
      'apparaît sous le ruban : semis en vert, récolte en or, et les apports d’azote en bleu.',
    placement: 'below',
  },
  {
    target: '.parcel-strip',
    title: 'Vos huit parcelles',
    body:
      'Cliquez une parcelle pour l’ouvrir et décider ce que vous y faites. Les trois barres donnent ' +
      'la Vigueur du couvert, l’Eau du sol et la Maturité de la culture. Les ronds « N » comptent les ' +
      'apports d’azote déjà faits, et le bandeau du bas indique l’intervention conseillée.',
    placement: 'above',
  },
  {
    target: '.weather-forecast',
    title: 'Le temps et les prévisions',
    body:
      'Le temps du tour en cours, puis trois prévisions dont la barre indique la fiabilité. ' +
      'Plus l’échéance est lointaine, moins il faut s’y fier. La grêle et les ravageurs, eux, ' +
      'n’y figurent jamais.',
    placement: 'right',
  },
  {
    target: '.hud-stocks',
    title: 'Le hangar',
    body:
      'Votre stock d’azote, de fongicide et d’insecticide. Il a été commandé en août et il ne ' +
      'couvre pas huit parcelles menées à fond : c’est là que se joue l’arbitrage de la campagne. ' +
      'Recommander est possible, plus cher, et livré au tour suivant.',
    placement: 'right',
  },
  {
    target: '.hud-money',
    title: 'La trésorerie',
    body:
      'Elle passera dans le rouge, c’est normal : les charges partent dès août et les recettes ' +
      'ne rentrent qu’en juillet. Ce qui compte, c’est le découvert encore disponible — au-delà, ' +
      'la banque refuse et l’intervention devient impossible.',
    placement: 'below',
  },
  {
    target: '.advance-button',
    title: 'Faire passer le temps',
    body:
      'Quand vos décisions sont prises, passez au tour suivant : la météo tombe, les cultures ' +
      'poussent, les ennuis arrivent. Rien ne bouge tant que vous ne cliquez pas.',
    placement: 'left',
  },
]

export class Coach {
  private readonly root: HTMLElement
  private readonly spotlight: HTMLElement
  private readonly bubble: HTMLElement
  private index = 0

  private constructor(private readonly parent: HTMLElement) {
    this.root = el('div', 'coach')
    this.spotlight = el('div', 'coach-spotlight')
    this.bubble = el('div', 'coach-bubble')
    this.root.append(this.spotlight, this.bubble)
    parent.append(this.root)
    this.show()
    window.addEventListener('resize', this.reposition)
  }

  /** Le joueur a-t-il déjà vu l'introduction ? */
  static hasBeenSeen(): boolean {
    try {
      return localStorage.getItem(SEEN_KEY) !== null
    } catch {
      // Sans stockage, on montre le guide : mieux vaut deux fois que jamais.
      return false
    }
  }

  /** Ne démarre le guide que si le joueur ne l'a jamais vu. */
  static startIfNeeded(parent: HTMLElement): Coach | null {
    if (Coach.hasBeenSeen()) return null
    return new Coach(parent)
  }

  private reposition = (): void => this.show()

  private show(): void {
    const step = STEPS[this.index]
    if (!step) return this.finish()

    const target = document.querySelector(step.target)
    if (!target) {
      // Cible absente (écran étroit) : on saute l'étape plutôt que de bloquer.
      this.index += 1
      return this.show()
    }

    const rect = target.getBoundingClientRect()
    const pad = 10
    this.spotlight.style.left = `${rect.left - pad}px`
    this.spotlight.style.top = `${rect.top - pad}px`
    this.spotlight.style.width = `${rect.width + pad * 2}px`
    this.spotlight.style.height = `${rect.height + pad * 2}px`

    this.bubble.replaceChildren()
    this.bubble.className = `coach-bubble is-${step.placement}`
    this.bubble.append(
      el('div', 'coach-step', `${this.index + 1} / ${STEPS.length}`),
      el('h3', 'coach-title', step.title),
      el('p', 'coach-body', step.body),
    )

    const buttons = el('div', 'coach-buttons')
    const skip = el('button', 'coach-skip', 'Passer le guide')
    skip.addEventListener('click', () => this.finish())
    const next = el(
      'button',
      'coach-next',
      this.index === STEPS.length - 1 ? 'Commencer' : 'Suivant',
    )
    next.addEventListener('click', () => {
      this.index += 1
      this.show()
    })
    buttons.append(skip, next)
    this.bubble.append(buttons)

    // Placement de la bulle, recadré pour ne jamais sortir de l'écran.
    // La hauteur est mesurée après remplissage : les dernières étapes visent
    // des cibles collées au bas de l'écran, et sans ce recadrage les boutons
    // finissent sous la ligne de flottaison, hors de portée.
    const margin = 14
    const bubbleWidth = 330
    this.bubble.style.transform = ''
    const bubbleHeight = this.bubble.offsetHeight

    let left = rect.left + rect.width / 2 - bubbleWidth / 2
    let top: number
    switch (step.placement) {
      case 'below':
        top = rect.bottom + 18
        break
      case 'above':
        top = rect.top - 18 - bubbleHeight
        break
      case 'right':
        left = rect.right + 18
        top = rect.top
        break
      default:
        left = rect.left - bubbleWidth - 18
        top = rect.top
    }

    const maxLeft = window.innerWidth - bubbleWidth - margin
    const maxTop = window.innerHeight - bubbleHeight - margin
    this.bubble.style.left = `${Math.max(margin, Math.min(left, maxLeft))}px`
    this.bubble.style.top = `${Math.max(margin, Math.min(top, maxTop))}px`
  }

  private finish(): void {
    try {
      localStorage.setItem(SEEN_KEY, '1')
    } catch {
      // Rien à faire : le guide se réaffichera, ce n'est pas grave.
    }
    window.removeEventListener('resize', this.reposition)
    this.root.classList.add('is-hidden')
    window.setTimeout(() => this.root.remove(), 400)
    void this.parent
  }
}
