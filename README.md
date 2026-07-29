# Belle Récolte

[![Vérifier et publier](https://github.com/yoanbernabeu/BelleRecolte/actions/workflows/deploy.yml/badge.svg)](https://github.com/yoanbernabeu/BelleRecolte/actions/workflows/deploy.yml)
[![Licence MIT](https://img.shields.io/badge/licence-MIT-d9a441)](LICENSE)

Jeu de gestion agricole en 3D, jouable dans le navigateur. Une campagne complète sur
96 hectares, du semis de colza de fin août à la dernière betterave de novembre suivant.

**→ [Jouer maintenant](https://yoanbernabeu.github.io/BelleRecolte/)** — gratuit, sans
inscription, rien à installer.

## Lancer le projet

```bash
npm install
npm run dev        # serveur de développement
npm run build      # build de production (typecheck + bundle)
npm test           # contrôles d'équilibrage
```

## Le principe

Une campagne agricole ne se confond pas avec l'année civile : elle va d'une récolte
à la suivante. Le jeu démarre à la seconde quinzaine d'août de l'année N, juste après
la moisson précédente, et s'achève à la première quinzaine de novembre de l'année N+1.

27 tours, en quinzaines pendant les périodes de travail et en mois entiers au cœur de
l'hiver, quand la végétation est à l'arrêt et qu'il n'y a presque rien à décider.

Chaque tour, le joueur consulte des prévisions météo de fiabilité décroissante, puis
décide parcelle par parcelle : semer, fertiliser, irriguer, traiter, récolter — dans la
limite d'un budget de campagne de 62 000 €.

## Page d'accueil et référencement

Le jeu s'ouvre sur une véritable page de présentation, écrite en **HTML statique
dans `index.html`** : environ 700 mots de contenu réel, une hiérarchie de titres
propre, les métadonnées Open Graph et Twitter, un lien canonique, et deux blocs
de données structurées JSON-LD (`VideoGame` et `FAQPage`). Un robot d'indexation
lit la page entière sans exécuter la moindre ligne de JavaScript.

Le moteur 3D est **chargé à la demande**, au clic sur « Commencer la campagne ».
Le bundle initial tombe ainsi de 529 ko à **5,2 ko** — le premier affichage
n'attend plus Three.js.

Le site est publié sur GitHub Pages à chaque poussée sur `main`, après passage du
contrôle de types, des tests d'équilibrage et de la compilation
(`.github/workflows/deploy.yml`). `vite.config.ts` utilise `base: './'` : les
ressources se résolvent donc relativement, et le jeu fonctionne aussi bien à la
racine d'un domaine que sous un sous-chemin.

## Apprendre à jouer

Le calendrier agricole est la chose la plus difficile à deviner : rien ne laisse
supposer que le colza se sème fin août pour être récolté onze mois plus tard.
Trois dispositifs répondent à ce problème.

La **page d'accueil** expose les règles et le calendrier de chaque culture, pour
qui veut comprendre avant de se lancer.

Le **ruban de campagne**, en haut de l'écran de jeu, montre en permanence les
quatre saisons et les vingt-sept tours. Survoler une culture y fait apparaître
ses fenêtres de semis et de récolte : le calendrier se lit, il ne se mémorise pas.

Un **guide contextuel** au premier tour désigne les quatre éléments de
l'interface, et ne se montre qu'une seule fois.

Enfin, chaque tour se clôt par un **récapitulatif** de ce qui vient de se passer :
la météo du tour, les dégâts et alertes en clair, les évolutions de culture
regroupées derrière un compteur.

## Direction artistique

Le paysage est clair, doré, chaleureux. L'interface est son exact contraire :
verre sombre couleur encre, filets laiton, titrage letterpress en Fraunces. Ce
contraste est délibéré — des panneaux clairs posés sur des champs de blé se
noyaient dedans et rendaient les deux illisibles.

Les polices sont auto-hébergées, aucune requête réseau au chargement.

## Jouer à plusieurs — le mode session

Une session réunit une dizaine de joueurs sur la même campagne, chacun sur son
poste, pendant **vingt minutes chronométrées**. L'organisateur crée la session,
annonce le code affiché à l'écran, voit la salle se remplir, puis donne le
départ — qui ferme la porte aux retardataires.

Tout le monde reçoit **la même graine**, donc la même météo, les mêmes aléas et
les mêmes prix : ce qui distingue les joueurs, ce sont leurs décisions, rien
d'autre. Chacun joue seul face à sa campagne et ne sait rien des autres ;
l'organisateur non plus. Le classement n'existe qu'à la fin, sur son seul poste.

Quand le chrono tombe, la campagne se clôt là où elle en est. Ce qui restait en
terre n'est pas récolté — mais **les charges de structure de l'année entière
sont dues**, comme dans la réalité : le fermage part que la parcelle produise ou
non. Un joueur qui n'a rien tenté termine ainsi à environ −71 400 €.

Deux classements sont affichés, **au tonnage** et **aux euros**, parce qu'ils
récompensent des choses opposées — l'audace d'un côté, la maîtrise des coûts de
l'autre, et donc deux vainqueurs possibles. Cas particulier prévu : si personne
n'a moissonné avant l'échéance, classer à la marge couronnerait celui qui n'a
rien fait ; le classement bascule alors sur les frais engagés.

Le jeu reste strictement statique et la simulation reste locale à chaque
navigateur. Un unique service sert de point de rendez-vous — graine, top départ,
chrono faisant autorité, collecte des résultats — sous la forme d'un Worker
Cloudflare avec une Durable Object par session (`worker/`), qui tient dans le
palier gratuit. Il ne connaît aucune règle du jeu.

```bash
cd worker
npm install
npm run deploy      # publie le point de rendez-vous
```

L'adresse obtenue se renseigne ensuite dans `VITE_SESSION_SERVER` à la
compilation du jeu. En cas d'incident — onglet fermé, navigateur qui plante — le
joueur retrouve sa campagne en rouvrant la page sur le même poste : le journal
de ses décisions est rejoué sur la même graine. Le chrono, lui, n'a pas été
suspendu.

Le mode solo n'est en rien modifié.

## Architecture

Le moteur de simulation (`src/sim/`) est du TypeScript pur, sans aucune dépendance au
rendu. Il tourne en test sans navigateur, ce qui permet de vérifier l'équilibrage en
simulant des dizaines de campagnes.

```
src/
  sim/          moteur : calendrier, météo, sols, cultures, économie, simulation
  render/       Three.js : monde, ciel, couvert végétal, précipitations, ambiance
  ui/           interface DOM : HUD, écrans, records
  session/      multijoueur : protocole, client, scores, classements
  audio/        ambiance générative Web Audio
  game.ts       orchestrateur — le seul module qui connaisse les deux côtés
worker/         point de rendez-vous des sessions (Cloudflare)
```

Aucun asset externe : le terrain, les bâtiments, la végétation, les shaders de culture
et l'intégralité du son sont générés en code.

## Les sources

Les paramètres agronomiques et économiques ne sont pas inventés. Ils viennent de :

- **Agreste** (ministère de l'Agriculture) — rendements et prix, récoltes 2024 et 2025,
  recensement agricole 2020 pour la structure des exploitations et la taille des parcelles
- **Chambre d'agriculture de l'Oise**, synthèse « Mes Parcelles » Hauts-de-France —
  charges opérationnelles réellement enregistrées par des agriculteurs, récolte 2024
- **Chambre d'agriculture des Landes** — marges brutes maïs et tournesol, millésime 2023
- **Arvalis**, **Terres Inovia**, **ITB** — fenêtres de semis et de récolte, stades
  phénologiques, seuils de traitement, besoins en eau, degrés-jours
- **Météo-France** — normales climatiques 1991-2020, corrigées d'environ 1 °C pour
  gommer l'îlot de chaleur urbain de la station de référence

## Ce que le modèle reproduit

Le rendement n'est pas tiré au sort. C'est le produit de facteurs construits tour après
tour : vigueur du couvert, satisfaction des besoins en eau, échaudage, nutrition azotée,
date de récolte, type de sol, verse.

Quelques comportements qui émergent des données plutôt que d'être scriptés :

- **L'irrigation est une assurance, pas un multiplicateur.** En année humide elle ne
  rembourse pas son coût ; en année sèche elle sauve la récolte.
- **Les prix sont anti-corrélés au rendement.** Une mauvaise année se vend mieux, ce qui
  amortit naturellement les chocs.
- **Le coût des insecticides n'est pas la sanction des ravageurs.** Le colza reçoit
  quatre passages pour moins de 20 €/ha ; la vraie perte est celle de la récolte.
- **La rotation contraint l'assolement**, à deux niveaux. Chaque parcelle porte
  ses trois précédents culturaux, et une culture ne peut pas revenir avant son
  délai de retour : quatre ans pour le colza et la betterave, trois pour le
  tournesol, deux pour le maïs. S'y ajoute un plafond de surface par culture.
  Les deux motifs de refus sont écrits en clair sur le bouton de semis.
- **Le délai avant récolte se paie.** Chaque traitement pose un DAR conforme aux
  règles d'emploi du catalogue E-Phy : 30 à 35 jours sur céréales, 45 sur
  betterave, 56 sur colza. Sauver une culture malade en fin de cycle, c'est
  s'interdire de moissonner pendant plusieurs tours.
- **Une culture peut être entièrement perdue.** Sous 35 % de satisfaction des
  besoins en eau elle grille sur pied, et l'effet s'aggrave à chaque tour
  consécutif. Sous 15 % de vigueur, la parcelle est retournée.

## Ce qui met la campagne sous tension

Le rendement agronomique ne fait pas le résultat économique. Quatre contraintes
transforment une bonne récolte en marge — ou l'inverse.

- **Le stock d'intrants est fini.** L'azote, les fongicides et les insecticides
  sont commandés en août, avant de connaître l'année, et la dotation couvre les
  deux tiers d'un itinéraire complet. Sans réapprovisionnement, une campagne bien
  conduite laisse en moyenne huit apports d'azote non faits. Recommander coûte
  20 % de plus qu'en achat groupé et prend un tour de livraison.
- **La moisson peut demander une entreprise.** Un chantier à une personne avance
  d'environ quatre hectares et demi par jour ouvrable, et blé, orge et colza
  mûrissent presque ensemble. L'ETA facture 165 à 495 €/ha selon la culture et ne
  prend que deux chantiers par quinzaine. Mesuré sur 200 campagnes : **dans 19 %
  d'entre elles, refuser l'entreprise coûte au moins une parcelle entière**, et
  elle rapporte environ 3 200 € de marge médiane.
- **La campagne se finance à découvert.** Les charges de structure — fermage,
  mécanisation, assurances, cotisations, frais généraux, soit 640 €/ha — sont
  prélevées à chaque tour, que la parcelle produise ou non. Les recettes
  n'arrivent qu'en juillet. L'autorisation bancaire est de 62 000 €, avec des
  agios de 0,25 % par quinzaine passée dans le rouge.
- **L'assurance récolte est un pari.** Souscrite parcelle par parcelle dans les
  deux tours qui suivent le semis, franchise de 30 %. Sur soixante campagnes,
  elle coûte environ 2 400 € de marge médiane et divise par deux le pire
  scénario.

S'y ajoutent les aléas qu'aucune prévision n'annonce : la grêle, qui hache une
parcelle et épargne sa voisine ; les sangliers sur le maïs au stade laiteux,
trois fois plus probables sur les trois parcelles d'angle que le bocage enveloppe ;
les corvidés qui suivent le semoir sur maïs et tournesol ; les limaces à la levée
dans un automne doux et humide.

Ces coups sont déjà portés quand le joueur reprend la main : ils remontent donc en
alerte de type « sinistre » à l'ouverture du tour, laissent une pastille sur la
carte de la parcelle pour toute la campagne, et une note dans son panneau de
détail. Une perte de vigueur dont on ignore la cause fait passer le jeu pour
arbitraire alors qu'il était seulement discret.

Résultat mesuré sur soixante campagnes conduites en suivant tous les conseils du
jeu : marge médiane de +16 600 €, **plus d'une campagne sur trois dans le rouge**,
pire cas à −52 000 €. Le test `balance.test.ts` verrouille ces bornes.

## Rejouabilité

Chaque campagne est déterminée par un code lisible et partageable (`MOISSON-4821`).
La ferme ne change jamais — mêmes parcelles, mêmes sols. Seule la météo dépend du code.
Deux joueurs qui saisissent le même code affrontent donc exactement la même année et
peuvent comparer leurs résultats.

Les meilleures campagnes sont conservées localement dans le navigateur.

## Licence

MIT — voir [LICENSE](LICENSE).
