# Refactor P1-A — Extraction des modules crypto de `public/app.js`

## Contexte

`public/app.js` a atteint ~7 860 lignes : crypto E2E, UI, routing, i18n, SSE
mélangés. Le bloc crypto (~1 500 lignes, lignes ~1066→2385) est la cible la plus
rentable : code cohérent, déjà accédé via le seul objet `host` côté plugins, et
sans dépendance vers l'UI. On l'extrait dans `public/crypto/*.js`.

`app.js` est chargé en **module ES** (`index.html` : `<script type="module">`),
donc l'extraction se fait en `import`/`export` natifs — pas de bundler.

## Principe de sûreté : déplacement VERBATIM

Le crypto web n'a **aucun test automatisé** (la parité crypto est garantie côté
TS/Android par `test/vectors/ratchet.json`). L'extraction doit donc être
strictement préservatrice du comportement : on **coupe/colle** le code tel quel,
on n'ajoute que les `import`/`export`. Aucune réécriture, aucune « amélioration »
au passage. Vérification = boot de l'app + aller-retour E2E manuel.

## État partagé : `crypto/state.js`

Le nœud du découpage est l'objet mutable `E2E` (clé privée, `pubStr`,
`needsRestore`/`needsBackup`, cache `shared`). Tous les modules le lisent et le
mutent. Solution : **une seule source de vérité** dans `crypto/state.js` qui
exporte la *référence* de l'objet `E2E` (+ `ECDH`, helpers base64). Comme les
modules importent la même référence, les mutations restent visibles partout.

## Carte des modules et dépendances

```
crypto/state.js   (E2E, ECDH, _b64/_unb64/_b64url/_unb64url)   ← foundation
   ↑
   ├── crypto/attach.js     (pièces jointes chiffrées — feuille isolée)
   ├── crypto/vault.js  ←→  crypto/e2e.js   (coffre PRF/passphrase ↔ session ECDH)
   ├── crypto/ratchet.js  ←→ crypto/multidevice.js   (Double Ratchet ↔ fan-out)
   ├── crypto/groups.js     (sender keys ; importe ratchet + e2e + host.md)
   └── crypto/verify.js     (numéro de sécurité anti-MITM ; importe ratchet + e2e)
```

Cycles assumés (résolus par les *live bindings* ES — appels uniquement à
l'exécution, jamais à l'évaluation du module) :
- `ratchet.ratchetEnsurePrekeys` → `multidevice.mdRegisterDevice`, et
  `multidevice` → nombreuses primitives `ratchet`.
- `e2e.ensureE2E` → `vault.e2eVaultGet`, et `vault` → mute `E2E.needsBackup`.

## Ordre d'extraction (du moins au plus couplé)

1. `state.js` (foundation) — débloque tout.
2. `attach.js` (feuille).
3. `e2e.js` + `vault.js` (ensemble).
4. `ratchet.js` (le plus gros).
5. `multidevice.js`.
6. `groups.js`.
7. `verify.js`.
8. Recâblage de `host` + suppression du code mort dans `app.js`.

Un commit par module, chacun vérifié (boot + round-trip) avant le suivant.

## Contrat `host` (frontière plugins)

Les plugins (`public/plugins/*.js`) n'importent **rien** d'`app.js` : ils
reçoivent `host` et consomment `host.e2e / ratchet / md / verify / groups /
attach`. Tant que la *forme* de `host` est préservée, les plugins ne changent
pas. `app.js` importe les modules crypto et les rebranche dans `host`.

## Mise en cache (Service Worker)

`sw.js` ne met pas de version (`?v=`) sur les `import` statiques (contrairement
aux plugins chargés en `import()` dynamique versionné). Mais le SW **purge tous
les caches** à l'`activate` quand `__V__` change (redémarrage/déploiement) : en
prod, chaque déploiement invalide les modules. En dev, forcer un rafraîchissement
matériel / désinscrire le SW lors d'itérations (cf. mémoire « rebuild-after-public-edits »,
« code web périmé = cache SW »).

## Résultat (P1-A livré)

`app.js` : 7860 → **6611 lignes** (−1249). Modules créés :

| Fichier | Lignes | Rôle |
|---------|-------:|------|
| `net.js` | 23 | api/authHeaders/jsonAuth (générique, hors crypto) |
| `crypto/state.js` | 27 | E2E, ECDH, base64 (socle partagé) |
| `crypto/attach.js` | 51 | pièces jointes chiffrées |
| `crypto/verify.js` | 59 | numéro de sécurité (crypto + API) |
| `crypto/e2e.js` | 111 | ECDH session v1 |
| `crypto/vault.js` | 164 | coffre de clé (PRF/passphrase/PIN) |
| `crypto/multidevice.js` | 186 | fan-out multi-appareils |
| `crypto/groups.js` | 210 | sender keys de groupe |
| `crypto/ratchet.js` | 535 | Double Ratchet + X3DH |

Deux affinements par rapport au plan initial :
- **`net.js`** ajouté : `api`/`authHeaders`/`jsonAuth` sont une couche réseau
  générique (pas du crypto), extraite en feuille pour casser le besoin des
  modules crypto d'accéder à l'état d'auth d'app.js. `KEY` reste la source de
  vérité dans app.js, reflétée via `setAccessKey()`.
- Les **modals UI** (`openSafetyNumber`, `openE2eBackup/Restore`, `openKeyRecovery`)
  **restent dans app.js** : seul le crypto/API est extrait. `crypto/verify.js`
  contient `safetyNumber`/`sha256hex`/`verify*` ; le modal les importe.

## Vérification

- **Parse ESM** : `node --check` sur chaque fichier (OK).
- **Link check** : résolution simulée de tout le graphe d'imports — chaque
  `import { X }` correspond à un `export` réel (OK, 0 problème).
- **Orphelins** : aucun identifiant crypto référencé sans import/définition.
- `npm test` : 130/131 (l'échec #11 « mutation par cookie / Origin → 401 » est
  un test **backend** préexistant, sans rapport avec ce refactor frontend ;
  P1-A ne touche pas `src/`).
- **Reste à faire (manuel, navigateur)** : aller-retour E2E réel — ratchet 1-1,
  groupe, pièce jointe, numéro de sécurité (doit rester identique octet-à-octet
  à TS/Android), sync multi-appareils. Penser au cache SW (rafraîchissement
  matériel en dev).
