# my²brain — design guidelines (direction 1B « Grille suisse »)

Source : itération design du 2026-07-05, variante 1B retenue.
Les tokens exacts vivent dans `design/tokens.json`. Ce doc fixe les règles
d'usage — tout écran de l'app doit pouvoir être justifié par ces règles.

## Esprit

Un artefact imprimé, pas une app SaaS. Papier blanc, encre noire, filets 1px,
un seul rouge suisse (#e2231a). Zéro radius, zéro ombre, zéro gradient, zéro
emoji. Si un élément ressemble à une « card », c'est raté : les sections sont
séparées par des filets et de l'espace, pas par des boîtes.

## La couleur code le type, l'opacité code la fraîcheur

- **Couleur = type de fichier** (palette catégorielle print `color.types`,
  mappée sur le dossier) : noir = core/racine, ocre = context, outremer =
  people, sapin = projects, prune = personal, ardoise = decisions, teal =
  domains, gris = inbox. Une légende accompagne toujours le graph.
- **Opacité = fraîcheur** : un fichier récent est plein (1.0), un vieux
  s'estompe (jusqu'à 0.35). Dans les listes texte, la fraîcheur reste des
  niveaux de gris (ramp `freshness`).
- **Rouge** : réservé à trois usages — urgence (échéance < 7 j), survol
  (nœud/edge hover), alerte critique (lien cassé, fichier périmé). Jamais
  décoratif, jamais un type de nœud.
- **Périmé** (au-delà du TTL de brain_health) : cercle en pointillés dans la
  couleur du type, mention rouge dans les listes.

## Typographie

Archivo seule, 4 graisses (400/500/700/800). Eyebrows en 11px uppercase
letterspaced pour nommer les sections, filets 1px noirs sous chaque eyebrow.
Chiffres en `tabular-nums` partout où ils s'alignent (dates, compteurs).
Pas de numéros fantômes ni de titre de vue au-dessus du canvas : le graph
occupe l'espace, la sidebar suffit à situer (décision produit, 2026-07-06).

## Data-vérité

La sidebar n'affiche que des données dérivables de l'API du Worker
(/api/graph, /api/health, /api/file, inbox). Rien d'inventé : pas de
« fichiers non commités » (le Worker ne voit que l'état GitHub, tout est
commité par construction), pas de métriques décoratives. Chaque chiffre
affiché doit avoir une route qui le fournit.

## Graph

- Taille du nœud ∝ degré ; remplissage = fraîcheur ; forme = état
  (plein / pointillé si périmé).
- Hover : le nœud GARDE sa couleur et prend un anneau rouge léger,
  les arêtes vers ses voisins passent au rouge, ses voisins
  restent encrés, le reste
  s'estompe. Les labels n'apparaissent que sur les hubs par défaut
  (toggle densité : hubs / tous / aucun).
- Les projets forment une constellation à droite du canvas via une force de
  clustering (positionnement seulement, jamais d'arêtes structurelles : un lien
  dans le brain doit porter du sens, et les orphelins doivent rester détectables).
- Le replay temporel est derrière un bouton, jamais l'état par défaut. Il se
  joue et **se quitte tout seul** en fin d'historique — pas de bouton quitter.
- Caption footnote sous le canvas : « N fichiers · N liens · taille ∝ degré ».

## Interdits (marqueurs IA)

Tirets longs (em-dashes) : aucun, nulle part dans l'interface, y compris dans
les titres affichés (remplacés par un point médian au rendu, fichiers intacts).
Cards flottantes, gradients, glassmorphism, violet, coins arrondis, ombres
portées, emojis, hero centré, badges pilule colorés. En cas de doute :
« est-ce que ça pourrait être imprimé dans un rapport suisse de 1972 ? »
