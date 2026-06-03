# mindlog · id — Langage visuel v3 (2026)

Source de vérité de la refonte visuelle de la **vue connectée** (`[data-view="private"]`).
Couche ajoutée par-dessus les tokens v1/v2 existants (échelle de rayons, topbar vitrée,
rail Fluent). Implémentée dans `public/style.css` (bloc « v3 2026 » + tokens `:root`).

## Principes
1. **Typographie affirmée** — corps à 16px, plancher 12px, nombres tabulaires.
2. **Surfaces en profondeur** — filet `--hairline` stable + liseré lumineux `--highlight`.
3. **Mouvement « spring »** — courbes/durées unifiées + View Transitions sur les onglets.
4. **Souveraineté/privacy d'abord** — police système (pas de CDN Google Fonts), zéro emoji
   structurel (icônes SVG via `ui/icons.js`), le 🦎 Milo reste comme signature de marque.

## Tokens (définis dans `:root`)
- Texte : `--fg` / `--fg-soft` (secondaire lisible) / `--muted` (tertiaire).
- Type : `--t-2xs`(12) `--t-xs`(13) `--t-sm`(14) `--t-base`(16) `--t-md`(18) `--t-lg`(22) `--t-xl`(28) `--t-2xl`(36).
- Relief : `--hairline`, `--highlight`.
- Mouvement : `--ease-out`, `--ease-spring`, `--dur-fast`(140) `--dur`(220) `--dur-slow`(340).
- Conservés : `--r-xs..xl`, `--r-pill`, `--elev-1..3`, accent caméléon (`--accent*`).

## Navigation (refonte)
Barre/rail **directe à 6 entrées**, ordre fixe : `Accueil · Chat · Réseau · Agenda · Galerie · Options`.
- Pas de menu « Plus » : trop peu d'onglets secondaires pour le justifier.
- **Mon ID** (Identité) accessible depuis l'Accueil (« Modifier ma carte », `data-goto`),
  pas dans la barre. **Notifications** = cloche du header → `deckGoLabel("Notifications")`.
- Liste `NAV` explicite dans `renderEditor`, **dédoublonnée par label** ; `allCols` est
  aussi dédoublonné par label (garde-fou : une colonne plugin contribuée deux fois — ex.
  « Galerie » en double — n'apparaît qu'une fois).
- `setupTabs` apparie l'état actif par `data-col` (une colonne hors barre n'allume rien).
  Transition d'onglet via `document.startViewTransition` (zone `#deck` nommée
  `deck-panel`, header/rail figés ; rejets « skipped » absorbés).

## Layout & responsive (pratiques 2026)
- **Échelle de breakpoints canonique** : `480 / 768 / 1024 / 1280`. Réserver les media
  queries au **châssis** ; ne pas réintroduire le nuage 560/600/640/720/760/820/880.
- **Grilles intrinsèques** (sans breakpoint) pour les listes uniformes :
  `repeat(auto-fit, minmax(min(100%, Npx), 1fr))` — déjà sur `.mcp-grid`, `.pr-grid`,
  `.pillars`, `.status-metrics`. (Réservé aux grilles « autant que possible » ; pour une
  grille bornée à 2 colonnes comme `.opt-v2-grid`, garder colonnes fixes.)
- **Sizing fluide** : `clamp()` / `minmax(0, …)` au lieu de px figés (`.comm-layout`
  liste = `clamp(240px,30%,320px)` ; `.field`/`.edit-field` label = `minmax(0,…)` + wrap).
- **Container queries** pour le responsive composant (`.col` = `container-type:inline-size`,
  `.comm-wrapper` = container nommé `comms`), media queries pour le **shell** uniquement.
  Pilotés par `@container` : Accueil (`hm-row`/`hm-stats`/`hm-row-hybrid`), Comms
  (master-detail via `:has(.chat-card)`), Options (`opt-v2-grid`/`access-grid`),
  formulaires Agenda, en-tête colonne Identité (`id-head`/`id-actions`/`id-tabs`).
  Restent en `@media` (à raison) : shell (rail 840 / hero 880), profil public
  (`.profile-*`), cartes partagées (`.card h1`/`.subtitle`), et `prefers-reduced-motion`.
- **Typo fluide** : `text-wrap: balance` sur titres, `text-wrap: pretty` sur paragraphes.
- Conteneurs : landing 1120, éditorial 960, profil public 540, statut 680, deck plein écran.

## Règles de rédaction UI
- Jamais de texte < 12px ; libellés de section en `--t-2xs` + `letter-spacing:.07em`.
- Stats/nombres : `--t-xl` + `font-variant-numeric: tabular-nums`.
- Une seule action primaire visuellement dominante par écran (`.btn.primary`).
- Icônes : un seul set SVG (`ICONS`), stroke 2, jamais d'emoji comme glyphe de contrôle.

## ⚠️ Parité (dette ouverte)
La v3 web **diverge** volontairement des surfaces Android (`Color.kt`) qui étaient alignées
verbatim. Pour rétablir la parité (mémoire `parity-all-clients`), répercuter sur Android :
échelle typo + hiérarchie texte, profondeur (hairline/highlight), barre 5+« Plus »,
transitions d'écran. À planifier comme chantier séparé.
