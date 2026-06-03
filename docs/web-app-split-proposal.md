# Proposition — découpage de `public/app.js` (suite de P1-A)

## Constat

Après l'extraction crypto (P1-A), `app.js` fait encore **6610 lignes**. Carte des
blocs (par bannières / fonctions) :

| Lignes | Bloc | Note |
|------:|------|------|
| ~1223 | `wireEditor()` | 🔴 monstre — listeners de l'éditeur |
| ~733 | `renderEditor()` | 🔴 rendu DOM de l'éditeur |
| ~690 | Landing (`renderLanding`/`wireLanding`/`wireShowcase`) | |
| ~655 | i18n (dico `I18N` + `t()`) | data pure |
| ~490 | Deck horizontal GSAP (`addDeckColumn`…) | |
| ~277 | Landing « grand public » (`renderSimpleLanding`) | |
| ~234 | Icônes + réseaux sociaux + SVG (Milo, avatars) | data + markup |
| ~174 | Visite guidée Shepherd (`startMiloTour`) | |
| ~143 | Modal création (`openCreate`) | |
| ~134 | Récupération de clé | |
| ~130 | Profil public (`renderPublicProfile`) | |
| ~122 | QR code | |
| ~115 | Geek-mode corner | |
| ~110 | Modal demande de RDV | |
| ~101 | Mascotte Milo globale | |
| reste | auth-state, utils/dialogs, SSE, thème, routeur, statut, boot, host | noyau |

Constat : l'**éditeur privé** (`renderEditor`+`wireEditor`+deck+nav+statut) pèse
~**2700 lignes** (40 %), la **landing** ~**1600**, et **i18n + icônes** ~**890**
sont du contenu statique trivial à sortir.

## Principe (même méthode que P1-A, éprouvée)

`app.js` est un **module ES** (`type="module"`), les plugins consomment déjà `host`.
On réutilise la recette qui a marché pour le crypto :

1. **Déplacement verbatim** (slices, jamais retapé). Le web n'a pas de tests auto.
2. Une **couche partagée** explicite (comme `net.js`/`crypto/state.js`) : tout le
   monde l'importe, personne ne la redéfinit.
3. **Imports calculés par intersection** (référencés ∩ exports réels) → zéro lien
   manquant.
4. Vérif : `node --check` (parse ESM) + **link-check** du graphe + boot manuel.
5. **`host` ne change pas de forme** → plugins intacts.

### Couche partagée (le socle, à faire en premier)

Les helpers « couture » utilisés partout (et déjà exposés via `host`) :
`esc`, `t` (+ `I18N`), `toast`, `copyText`, `confirmDialog`, `promptPin`,
`promptPassphrase`, `icon`/`ICONS`, `avatarHtml`, `profileChipHtml`, `miloSvg`,
`applyTheme`/`applyAccent`. Ils partent dans :

- `public/i18n.js` — `I18N` + `t()` (655 l., data pure, **risque nul**)
- `public/ui/icons.js` — `ICONS`, `SOCIALS`, `socialUrl/Icon`, `miloSvg`,
  `branchNavSvg`, `genericAvatarSvg`, `avatarHtml`, `profileChipHtml`, `icon`
- `public/ui/dom.js` — `esc`, `toast`, `copyText`, `confirmDialog`, `promptPin`,
  `promptPassphrase` (modales génériques)
- `public/theme.js` — `applyTheme`, `applyAccent`, `setupBrandMilo`

`net.js` (déjà créé) complète le socle. `app.js` et tous les futurs modules
importent depuis là.

## Cible (arborescence)

```
public/
├── app.js                 ← noyau mince : auth-state, SSE, routeur, boot, host (~500-700 l.)
├── net.js                 ← (déjà) api/auth headers
├── i18n.js                ← I18N + t()
├── theme.js               ← thème + accent + brand Milo
├── crypto/…               ← (déjà) state/e2e/vault/ratchet/multidevice/groups/verify/attach
├── ui/
│   ├── dom.js             ← esc, toast, dialogs génériques
│   ├── icons.js           ← icônes, réseaux sociaux, SVG, avatars, chips
│   └── modals.js          ← openE2eBackup/Restore, openKeyRecovery, openSafetyNumber, QR
├── views/
│   ├── landing.js         ← renderLanding + wireLanding + wireShowcase + grand-public
│   ├── milo-tour.js       ← geek-corner + mascotte + visite guidée Shepherd
│   ├── onboarding.js      ← openCreate + récupération de clé + invitation
│   └── public-profile.js  ← renderPublicProfile + modal RDV
└── editor/
    ├── index.js           ← renderPrivate (orchestrateur) + renderEditor (assemblage)
    ├── deck.js            ← addDeckColumn/removeDeckColumn/nav GSAP
    ├── status.js          ← renderStatus
    └── tabs/
        ├── profile.js     ← rendu + wiring de l'onglet Profil
        ├── network.js     ← onglet Réseau (relations, demandes)
        ├── agenda.js      ← onglet Agenda
        └── options.js     ← onglet Options (confidentialité/sécurité/accès/compte)
```

## Plan phasé (du moins au plus risqué)

| # | Lot | Gain (~l.) | Risque | Vérif |
|--|-----|-----------:|--------|-------|
| **B1** | `i18n.js` | 655 | nul | parse+link |
| **B2** | `ui/icons.js` | 234 | nul | parse+link |
| **B3** | `theme.js` | 130 | faible | parse+link |
| **B4** | `ui/dom.js` (esc, toast, dialogs) | 200 | faible | parse+link (socle critique) |
| **B5** | `ui/modals.js` (E2E/QR/safety) | 350 | faible | manuel : ouvrir chaque modale |
| **B6** | `views/milo-tour.js` | 390 | faible | manuel : lancer la visite |
| **B7** | `views/onboarding.js` (create/recovery/invite) | 330 | moyen | manuel : créer un compte |
| **B8** | `views/landing.js` | 970 | moyen | manuel : page d'accueil |
| **B9** | `views/public-profile.js` | 240 | moyen | manuel : `/@handle` |
| **B10** | `editor/deck.js` + `editor/status.js` | 560 | moyen | manuel : ouvrir une colonne chat |
| **B11** | `editor/` + découpe `renderEditor`/`wireEditor` **par onglet** | ~1950 | 🔴 élevé | manuel : éditer chaque onglet |

Après B1→B10, `app.js` ≈ 2700 l. ; après B11 ≈ **500–700 l.** (noyau).

## Le cas épineux : l'éditeur (B11)

`renderEditor` (DOM) et `wireEditor` (listeners) sont couplés (mêmes closures,
objet `data`, deck, `host`). Stratégie, calquée sur P1-B (Android Settings) :

- découper **par onglet** : chaque `tabs/X.js` exporte `renderX(data, ctx)` **et**
  `wireX(data, ctx)` ;
- un objet `ctx` (dépendances : `host`, `deck`, `renderPrivate`, helpers UI) passé
  explicitement remplace les closures partagées — pas de variable globale cachée ;
- `editor/index.js` orchestre : assemble les `renderX`, puis appelle les `wireX`.

C'est le lot le plus lourd : à faire **en dernier**, onglet par onglet, chacun
committé et vérifié séparément.

## Garde-fous

- `host` garde exactement la même forme (les plugins n'importent rien d'`app.js`).
- Cache SW : imports statiques non versionnés → invalidés au bump de `__V__` en
  prod ; en dev, rafraîchissement matériel (cf. `docs/web-crypto-modules.md`).
- Pas de tests auto web → chaque lot vérifié par parse ESM + link-check + un
  aller-retour manuel ciblé (colonne indiquée dans le tableau).
