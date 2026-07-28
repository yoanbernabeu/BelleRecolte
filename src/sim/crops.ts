/**
 * Les cultures.
 *
 * Sept cultures qui couvrent l'essentiel d'un assolement de grandes cultures
 * du Bassin parisien. Trois sont semées à l'automne et passent l'hiver au
 * champ, quatre sont semées au printemps : c'est cette opposition qui donne
 * sa structure à la campagne, et qui oblige à répartir le risque.
 *
 * Fenêtres de semis et de récolte : Chambres d'agriculture, Arvalis,
 * Terres Inovia, ITB.
 * Rendements de référence et plafonds : Agreste (récoltes 2024 et 2025),
 * panel « Mes Parcelles » Hauts-de-France pour les zones à fort potentiel.
 */

export type CropId =
  | 'ble-tendre-hiver'
  | 'orge-hiver'
  | 'colza-hiver'
  | 'orge-printemps'
  | 'mais-grain'
  | 'tournesol'
  | 'betterave'

export type CropCycle = 'hiver' | 'printemps'

export interface TurnWindow {
  /** Premier tour où l'opération est possible. */
  readonly earliest: number
  /** Début de la fenêtre optimale. */
  readonly bestFrom: number
  /** Fin de la fenêtre optimale. */
  readonly bestTo: number
  /** Dernier tour où l'opération reste possible. */
  readonly latest: number
}

/**
 * Floraison visible depuis le bout du champ.
 *
 * Toutes les cultures fleurissent, mais deux seulement changent la couleur du
 * paysage : le colza en avril et le tournesol en juillet. Les bornes sont
 * exprimées en fraction de la somme de températures jusqu'à maturité, comme le
 * reste du développement.
 */
export interface CropBloom {
  readonly color: number
  readonly from: number
  readonly peak: number
  readonly to: number
}

export interface CropAppearanceStages {
  /** Couleur du couvert jeune. */
  readonly young: number
  /** Couleur à pleine végétation. */
  readonly mature: number
  /** Couleur à maturité de récolte. */
  readonly ripe: number
  /** Hauteur du couvert à maturité, en unités de monde (stylisée). */
  readonly height: number
  /** Écartement des rangs en unités ; 0 pour un semis dense en ligne serrée. */
  readonly rowSpacing: number
  /** Souplesse au vent, 0 = rigide (betterave), 1 = ondule (céréales). */
  readonly sway: number
  /** Floraison spectaculaire, quand la culture en a une. */
  readonly bloom?: CropBloom
}

/**
 * Paramètres physiologiques.
 *
 * Les sommes de températures sont exprimées en degrés-jours cumulés depuis le
 * semis, avec la température de base propre à l'espèce (0 °C pour les céréales
 * et la betterave selon les conseils ITB, 6 °C pour le maïs et le tournesol).
 * Les valeurs de cycle sont recoupées avec les normales climatiques françaises
 * et les dates de récolte observées.
 */
export interface Physiology {
  /** Température de base pour le cumul de degrés-jours, °C. */
  readonly baseTemp: number
  /** Degrés-jours du semis à la levée. */
  readonly gddEmergence: number
  /** Degrés-jours du semis à la maturité de récolte. */
  readonly gddMaturity: number
  /**
   * Tour avant lequel la culture ne peut pas passer en phase reproductive,
   * quels que soient les degrés-jours accumulés.
   *
   * Sans ce garde-fou, un colza semé fin août aurait cumulé assez de chaleur
   * pour « fleurir » dès février : les céréales d'hiver et le colza ont besoin
   * de vernalisation et de jours qui rallongent, pas seulement de chaleur.
   */
  readonly reproductiveFrom: number
  /** Sous cette minimale, la culture subit des dégâts en phase végétative, °C. */
  readonly frostVegetative: number
  /** Sous cette minimale, dégâts en phase reproductive (épi, floraison), °C. */
  readonly frostReproductive: number
  /** Au-dessus de cette maximale, échaudage pendant le remplissage, °C. */
  readonly heatThreshold: number
  /** Besoin en eau sur le cycle, mm. */
  readonly waterNeedMm: number
  /**
   * Coefficient cultural par stade, pour l'évapotranspiration réelle.
   * Ordre : levée, croissance, floraison, remplissage, maturation.
   */
  readonly cropCoefficients: readonly [number, number, number, number, number]
  /** Sensibilité à la verse 0→1 (0 = ne verse pas). */
  readonly lodgingSusceptibility: number
  /** Sensibilité aux maladies foliaires 0→1. */
  readonly diseaseSusceptibility: number
  /** Sensibilité aux ravageurs 0→1. */
  readonly pestSusceptibility: number
  /**
   * Fenêtres de risque ravageurs, en index de tour.
   * Le colza en compte cinq de l'automne au printemps, l'orge de printemps
   * aucune — c'est ce qui différencie vraiment leur conduite.
   */
  readonly pestWindows: readonly (readonly [number, number])[]
}

export interface NitrogenSplit {
  readonly label: string
  /** Premier tour de la fenêtre optimale. */
  readonly from: number
  /** Dernier tour de la fenêtre optimale. */
  readonly to: number
}

export interface Crop {
  readonly id: CropId
  readonly name: string
  /** Nom court pour les pastilles de l'interface. */
  readonly shortName: string
  readonly cycle: CropCycle
  readonly description: string
  readonly sowing: TurnWindow
  readonly harvest: TurnWindow
  /** Rendement de référence en année moyenne, t/ha. */
  readonly referenceYield: number
  /** Plafond atteignable dans d'excellentes conditions, t/ha. */
  readonly potentialYield: number
  /** Dose d'azote de référence, unités N/ha. */
  readonly nitrogenUnits: number
  /** Nombre d'apports d'azote de l'itinéraire de référence. */
  readonly nitrogenSplits: number
  /**
   * Calendrier des apports : un libellé et une fenêtre de tours par passage.
   *
   * Le fractionnement n'est pas une préférence, c'est ce qui décide du rendement
   * et du taux de protéines. Un apport posé hors de sa fenêtre n'est pas perdu,
   * mais il est mal valorisé : la plante n'en est pas au stade où elle l'absorbe.
   */
  readonly nitrogenSchedule: readonly NitrogenSplit[]
  /** La raison agronomique propre à cette culture, affichée dans le panneau. */
  readonly nitrogenNote: string
  /** L'irrigation change-t-elle vraiment le résultat sur cette culture ? */
  readonly irrigationMatters: boolean
  /**
   * Part maximale de la SAU que cette culture peut occuper sur une campagne.
   *
   * Ce n'est pas une règle de jeu arbitraire : les rotations réelles imposent
   * un délai de retour sur la même parcelle (quatre ans pour le colza et la
   * betterave, sous peine de maladies telluriques et de nématodes). Personne ne
   * fait 96 hectares de colza. Sans ce plafond, semer partout la culture la
   * mieux valorisée serait la stratégie optimale, ce qui est faux.
   */
  readonly maxShare: number
  /**
   * Délai de retour sur la même parcelle, en années.
   *
   * Le colza et la betterave imposent quatre ans (hernie des crucifères,
   * nématode à kystes, sclérotinia) ; Terres Inovia recommande un retour
   * du tournesol « 1 an sur 3 minimum » ; le maïs est limité à deux années
   * sur trois dans les zones à chrysomèle. Les céréales à paille, elles,
   * peuvent se suivre — 29 % des blés français ont un précédent céréale.
   */
  readonly returnIntervalYears: number
  readonly physiology: Physiology
  readonly appearance: CropAppearanceStages
}

/**
 * Repères de calendrier, en index de tour (voir calendar.ts) :
 *   0 août N II · 1-2 sept N · 3-4 oct N · 5-6 nov N · 7 déc · 8 janv · 9 févr
 *   10-11 mars · 12-13 avril · 14-15 mai · 16-17 juin · 18-19 juillet
 *   20-21 août N+1 · 22-23 sept · 24-25 oct · 26 nov N+1
 */
export const CROPS: Record<CropId, Crop> = {
  'colza-hiver': {
    id: 'colza-hiver',
    name: "Colza d'hiver",
    shortName: 'Colza',
    cycle: 'hiver',
    description:
      "Se sème le premier, dès la fin août, et se récolte onze mois plus tard. Tête de rotation qui laisse un sol propre, mais l'implantation d'automne se joue à quelques jours près : un colza mal levé se fait dévorer par les altises.",
    sowing: { earliest: 0, bestFrom: 0, bestTo: 1, latest: 2 },
    harvest: { earliest: 17, bestFrom: 18, bestTo: 19, latest: 20 },
    referenceYield: 3.67,
    potentialYield: 5.2,
    nitrogenUnits: 170,
    nitrogenSplits: 3,
    nitrogenSchedule: [
      { label: 'Sortie d’hiver, après pesée de la biomasse', from: 9, to: 10 },
      { label: 'Reprise de végétation', from: 10, to: 11 },
      { label: 'Avant montaison', from: 11, to: 12 },
    ],
    nitrogenNote:
      "Plus le colza est développé en sortie d’hiver, moins il faut d’azote au printemps : il en a déjà stocké dans ses feuilles. Jamais plus de 100 unités en un seul passage.",
    irrigationMatters: false,
    maxShare: 0.25,
    returnIntervalYears: 4,
    physiology: {
      baseTemp: 0,
      gddEmergence: 130,
      gddMaturity: 3450,
      reproductiveFrom: 11,
      // Un colza bien implanté résiste à −15 °C ; le seuil létal est vers −18.
      frostVegetative: -15,
      frostReproductive: -4,
      heatThreshold: 28,
      waterNeedMm: 450,
      cropCoefficients: [0.4, 0.85, 1.1, 1.0, 0.6],
      lodgingSusceptibility: 0.35,
      diseaseSusceptibility: 0.5,
      pestSusceptibility: 1,
      // Les cinq fenêtres du calendrier ravageurs du colza : altises à l'automne,
      // charançon du bourgeon terminal, charançon de la tige, méligèthes,
      // charançon des siliques. C'est la culture la plus surveillée de toutes.
      pestWindows: [
        [0, 3],
        [4, 7],
        [9, 11],
        [11, 13],
        [13, 15],
      ],
    },
    appearance: {
      young: 0x4a7a35,
      mature: 0x6f8f3e,
      ripe: 0x9a8a55,
      height: 0.44,
      // Le colza se sème à 35-45 cm entre rangs : c'est la seule culture
      // d'hiver dont on distingue les lignes jusqu'à la couverture du sol.
      rowSpacing: 0.9,
      sway: 0.8,
      // Calé sur les degrés-jours réellement accumulés par le moteur : le
      // colza franchit 0,55 fin mars et 0,73 à la mi-mai. C'est bien la
      // fenêtre où la plaine passe au jaune.
      bloom: { color: 0xf2d833, from: 0.55, peak: 0.63, to: 0.73 },
    },
  },

  'orge-hiver': {
    id: 'orge-hiver',
    name: "Orge d'hiver",
    shortName: 'Orge H.',
    cycle: 'hiver',
    description:
      "Semée avant le blé, récoltée avant lui : la première moisson de l'année, dès la mi-juin. Elle libère la parcelle tôt, mais verse facilement et le puceron d'automne lui transmet la jaunisse nanisante.",
    sowing: { earliest: 2, bestFrom: 3, bestTo: 3, latest: 4 },
    harvest: { earliest: 16, bestFrom: 16, bestTo: 17, latest: 18 },
    referenceYield: 7.03,
    potentialYield: 10,
    nitrogenUnits: 150,
    nitrogenSplits: 2,
    nitrogenSchedule: [
      { label: 'Tallage, dès la reprise', from: 9, to: 10 },
      { label: 'Épi 1 cm', from: 11, to: 12 },
    ],
    nitrogenNote:
      "L’escourgeon redémarre avant les blés : son premier apport se fait plus tôt, mais jamais avant le 1er février. Deux apports suffisent en dessous de 160 unités.",
    irrigationMatters: false,
    maxShare: 0.3,
    returnIntervalYears: 1,
    physiology: {
      baseTemp: 0,
      gddEmergence: 140,
      gddMaturity: 2350,
      reproductiveFrom: 13,
      // L'orge est plus sensible au gel hivernal que le blé : −10 à −15 °C au
      // tallage, contre −15 à −20 pour un blé endurci.
      frostVegetative: -10,
      frostReproductive: -4,
      heatThreshold: 25,
      waterNeedMm: 400,
      cropCoefficients: [0.4, 0.9, 1.15, 1.0, 0.5],
      // L'escourgeon verse plus facilement que le blé : c'est pour ça que son
      // poste régulateur de croissance coûte plus cher.
      lodgingSusceptibility: 0.7,
      diseaseSusceptibility: 0.55,
      pestSusceptibility: 0.5,
      // Puceron d'automne vecteur de la jaunisse nanisante (JNO).
      pestWindows: [[3, 6]],
    },
    appearance: {
      young: 0x5c8038,
      mature: 0x8fa845,
      ripe: 0xd9c377,
      height: 0.38,
      rowSpacing: 0,
      sway: 1,
    },
  },

  'ble-tendre-hiver': {
    id: 'ble-tendre-hiver',
    name: 'Blé tendre d’hiver',
    shortName: 'Blé',
    cycle: 'hiver',
    description:
      "La culture reine, semée autour de la mi-octobre. Robuste et régulière, mais la septoriose peut lui coûter jusqu'à 23 quintaux si on laisse filer, et le prix couvre rarement le coût de production.",
    sowing: { earliest: 3, bestFrom: 3, bestTo: 5, latest: 6 },
    harvest: { earliest: 17, bestFrom: 18, bestTo: 19, latest: 21 },
    referenceYield: 7.42,
    potentialYield: 11,
    nitrogenUnits: 180,
    nitrogenSplits: 3,
    nitrogenSchedule: [
      { label: 'Tallage', from: 10, to: 11 },
      { label: 'Épi 1 cm', from: 11, to: 12 },
      { label: 'Dernière feuille', from: 12, to: 13 },
    ],
    nitrogenNote:
      "Trois apports plutôt que deux, à dose égale, rapportent environ 1 quintal et 0,3 point de protéines. Le dernier passage joue surtout sur la qualité du grain.",
    irrigationMatters: false,
    maxShare: 0.55,
    returnIntervalYears: 1,
    physiology: {
      baseTemp: 0,
      gddEmergence: 140,
      gddMaturity: 2700,
      reproductiveFrom: 14,
      frostVegetative: -15,
      frostReproductive: -4,
      // Au-delà de 25 °C pendant le remplissage, le grain s'échaude.
      heatThreshold: 25,
      waterNeedMm: 450,
      cropCoefficients: [0.4, 0.9, 1.15, 1.05, 0.5],
      lodgingSusceptibility: 0.45,
      // Septoriose : neuf hectares sur dix reçoivent un fongicide, et la maladie
      // peut coûter jusqu'à 23 quintaux si on laisse filer.
      diseaseSusceptibility: 0.75,
      pestSusceptibility: 0.3,
      pestWindows: [[4, 6]],
    },
    appearance: {
      young: 0x4f7a33,
      mature: 0x7fa044,
      ripe: 0xe0c46a,
      height: 0.42,
      rowSpacing: 0,
      sway: 1,
    },
  },

  'orge-printemps': {
    id: 'orge-printemps',
    name: 'Orge de printemps',
    shortName: 'Orge P.',
    cycle: 'printemps',
    description:
      "Cycle court, peu d'intrants, la culture la moins traitée. Vendue en brassicole elle vaut une prime — à condition que le calibrage passe et que le taux de protéines reste sous 11,5 %. Trop d'azote et le lot est déclassé en fourragère.",
    sowing: { earliest: 9, bestFrom: 10, bestTo: 11, latest: 12 },
    harvest: { earliest: 18, bestFrom: 18, bestTo: 19, latest: 20 },
    referenceYield: 5.88,
    potentialYield: 7.5,
    nitrogenUnits: 115,
    nitrogenSplits: 2,
    nitrogenSchedule: [
      { label: 'Au semis, un tiers de la dose', from: 10, to: 12 },
      { label: 'Tallage, les deux tiers restants', from: 12, to: 13 },
    ],
    nitrogenNote:
      "C’est ici que se joue la prime brassicole : trop d’azote fait monter les protéines au-dessus de 11,5 % et le lot est déclassé en fourragère. Viser juste vaut mieux que viser haut.",
    irrigationMatters: false,
    maxShare: 0.25,
    returnIntervalYears: 1,
    physiology: {
      baseTemp: 0,
      gddEmergence: 130,
      gddMaturity: 1750,
      reproductiveFrom: 14,
      frostVegetative: -6,
      frostReproductive: -3,
      heatThreshold: 25,
      waterNeedMm: 330,
      cropCoefficients: [0.4, 0.9, 1.1, 0.95, 0.45],
      lodgingSusceptibility: 0.4,
      diseaseSusceptibility: 0.4,
      // La culture la moins traitée : pas de puceron d'automne à gérer, et le
      // travail du sol de printemps a détruit les adventices d'hiver.
      pestSusceptibility: 0.1,
      pestWindows: [],
    },
    appearance: {
      young: 0x5f8a3a,
      mature: 0x93ad4c,
      ripe: 0xdcc87e,
      height: 0.34,
      rowSpacing: 0,
      sway: 1,
    },
  },

  betterave: {
    id: 'betterave',
    name: 'Betterave sucrière',
    shortName: 'Better.',
    cycle: 'printemps',
    description:
      "La plus rentable et la plus exigeante : semences chères, désherbage en micro-doses répétées, arrachage à payer. Depuis l'interdiction des néonicotinoïdes, la jaunisse transmise par les pucerons peut coûter un tiers de la récolte.",
    sowing: { earliest: 10, bestFrom: 11, bestTo: 11, latest: 12 },
    harvest: { earliest: 23, bestFrom: 24, bestTo: 25, latest: 26 },
    referenceYield: 84.9,
    potentialYield: 100,
    nitrogenUnits: 110,
    nitrogenSplits: 1,
    nitrogenSchedule: [
      // L'apport se fait avant ou pendant le semis. La fenêtre couvre les deux :
      // le joueur ne pouvant fertiliser qu'une parcelle emblavée, la borner
      // au seul mois de mars la rendait inatteignable.
      { label: 'Au semis, apport unique', from: 10, to: 12 },
    ],
    nitrogenNote:
      "La betterave se fractionne mal : au-delà de 80 unités, diviser l’apport n’améliore rien. Un surdosage coûte 0,35 point de richesse par tranche de 40 unités excédentaires.",
    irrigationMatters: true,
    maxShare: 0.25,
    returnIntervalYears: 4,
    physiology: {
      // L'ITB raisonne en base 0 °C dans ses conseils de terrain ; la levée est
      // acquise vers 144 °C.j, soit environ 15 jours et demi après le semis.
      baseTemp: 0,
      gddEmergence: 144,
      gddMaturity: 3300,
      reproductiveFrom: 15,
      // Dégâts de gelée printanière à partir de −3 °C sur semis précoces ;
      // −5 °C est le seuil de résistance normal.
      frostVegetative: -5,
      frostReproductive: -3,
      // La croissance ralentit nettement au-dessus de 30 °C et s'arrête à 35 °C.
      heatThreshold: 30,
      waterNeedMm: 650,
      cropCoefficients: [0.35, 0.8, 1.2, 1.15, 0.85],
      lodgingSusceptibility: 0,
      // Cercosporiose, oïdium, rouille, ramulariose : deuxième culture la plus
      // traitée de France derrière la pomme de terre. La sensibilité reste
      // élevée, mais un programme fongicide suivi la contient.
      diseaseSusceptibility: 0.62,
      // Puceron vert vecteur de la jaunisse, sans néonicotinoïdes depuis 2023.
      // Sensibilité maximale au stade 2 feuilles, décroissante jusqu'à 8 feuilles.
      pestSusceptibility: 0.95,
      pestWindows: [[12, 15]],
    },
    appearance: {
      young: 0x4a7a3c,
      mature: 0x2f5c2c,
      ripe: 0x3d6635,
      height: 0.3,
      rowSpacing: 1.2,
      sway: 0.25,
    },
  },

  tournesol: {
    id: 'tournesol',
    name: 'Tournesol',
    shortName: 'Tourn.',
    cycle: 'printemps',
    description:
      "Rustique et sobre : deux fois moins de charges que le maïs, un pivot qui va chercher l'eau en profondeur. L'irrigation ne lui apporte presque rien. En revanche les oiseaux peuvent ravager une parcelle isolée, et aucun produit n'y fait.",
    sowing: { earliest: 12, bestFrom: 12, bestTo: 13, latest: 14 },
    harvest: { earliest: 21, bestFrom: 22, bestTo: 23, latest: 24 },
    referenceYield: 2.09,
    potentialYield: 4.2,
    nitrogenUnits: 60,
    nitrogenSplits: 1,
    nitrogenSchedule: [{ label: 'Apport unique, entre 6 et 14 feuilles', from: 14, to: 16 }],
    nitrogenNote:
      "Son pivot va chercher l’azote en profondeur : il couvre la moitié de ses besoins par les reliquats du sol. L’excès est contre-productif — il favorise les maladies et fait baisser le taux d’huile, donc le prix payé.",
    irrigationMatters: false,
    maxShare: 0.3,
    returnIntervalYears: 3,
    physiology: {
      baseTemp: 6,
      gddEmergence: 90,
      gddMaturity: 1620,
      reproductiveFrom: 15,
      frostVegetative: -1,
      frostReproductive: 0,
      // 33-35 °C à la floraison : pollen altéré, akènes vides.
      heatThreshold: 33,
      // Son pivot descend chercher l'eau : besoins modestes et grande rusticité.
      waterNeedMm: 420,
      cropCoefficients: [0.35, 0.75, 1.1, 0.9, 0.4],
      lodgingSusceptibility: 0.2,
      // Sclérotinia et phomopsis sont gérés par la génétique, pas la chimie.
      diseaseSusceptibility: 0.2,
      // Oiseaux et gibier : dégâts majeurs, aucune parade chimique efficace.
      pestSusceptibility: 0.55,
      pestWindows: [[13, 15], [21, 23]],
    },
    appearance: {
      young: 0x4e7f34,
      mature: 0x6f9a3a,
      ripe: 0x8a7a3e,
      height: 0.55,
      rowSpacing: 1.4,
      sway: 0.45,
      // Semé mi-avril, récolté en septembre : la floraison tombe à la mi-juillet.
      bloom: { color: 0xe8bb2e, from: 0.5, peak: 0.62, to: 0.75 },
    },
  },

  'mais-grain': {
    id: 'mais-grain',
    name: 'Maïs grain',
    shortName: 'Maïs',
    cycle: 'printemps',
    description:
      "Le plus gros potentiel de tous, et le plus gourmand en eau. Sans irrigation, une canicule peut lui coûter 30 quintaux. Mais l'irrigation est une assurance, pas un multiplicateur : les années humides, elle ne rembourse même pas son coût.",
    sowing: { earliest: 12, bestFrom: 13, bestTo: 14, latest: 15 },
    harvest: { earliest: 23, bestFrom: 24, bestTo: 25, latest: 26 },
    referenceYield: 8.59,
    potentialYield: 15,
    nitrogenUnits: 190,
    nitrogenSplits: 2,
    nitrogenSchedule: [
      { label: 'Starter au semis', from: 12, to: 14 },
      { label: 'En végétation, avant 10 feuilles', from: 14, to: 16 },
    ],
    nitrogenNote:
      "Le maïs consomme beaucoup et tard. Le starter au semis lance la plante, l’apport en végétation accompagne la montée en biomasse jusqu’à la floraison.",
    irrigationMatters: true,
    maxShare: 0.3,
    returnIntervalYears: 2,
    physiology: {
      baseTemp: 6,
      gddEmergence: 100,
      gddMaturity: 1950,
      reproductiveFrom: 16,
      frostVegetative: -1,
      frostReproductive: 0,
      // Dès 35 °C, la viabilité du pollen et la fécondation chutent de moitié.
      // C'est le seuil le mieux documenté de toute la fiche maïs.
      heatThreshold: 35,
      // Le plus gros besoin en eau de l'assolement, concentré en juillet-août.
      waterNeedMm: 550,
      cropCoefficients: [0.35, 0.8, 1.2, 1.1, 0.6],
      lodgingSusceptibility: 0.25,
      diseaseSusceptibility: 0.1,
      // Pyrale, essentiellement.
      pestSusceptibility: 0.35,
      pestWindows: [[17, 20]],
    },
    appearance: {
      young: 0x4c8033,
      mature: 0x2f6b2a,
      ripe: 0xa89344,
      height: 0.72,
      rowSpacing: 1.6,
      sway: 0.5,
    },
  },
}

export const CROP_IDS = Object.keys(CROPS) as CropId[]

export function getCrop(id: CropId): Crop {
  return CROPS[id]
}

/** Cultures semables au tour donné. */
export function sowableAt(turn: number): Crop[] {
  return CROP_IDS.map(getCrop).filter(
    (crop) => turn >= crop.sowing.earliest && turn <= crop.sowing.latest,
  )
}

/** Qualité de la date de semis, 0→1. Hors fenêtre optimale, le potentiel baisse. */
export function sowingQuality(crop: Crop, turn: number): number {
  const { earliest, bestFrom, bestTo, latest } = crop.sowing
  if (turn < earliest || turn > latest) return 0
  if (turn >= bestFrom && turn <= bestTo) return 1
  if (turn < bestFrom) {
    const span = bestFrom - earliest
    return span <= 0 ? 1 : 0.84 + 0.16 * ((turn - earliest) / span)
  }
  const span = latest - bestTo
  return span <= 0 ? 1 : 1 - 0.35 * ((turn - bestTo) / span)
}
