# Tests e2e navigateur (Playwright)

Vérification automatisée du front web en pilotant Chromium. Sert surtout de
**garde-fou de régression pour l'éclatement de `public/app.js` en modules ES** :
si un `import` casse (export manquant, orphelin), l'app `type="module"` ne
démarre pas et le scénario « boot » échoue immédiatement.

## Lancer

```bash
# une seule fois : télécharger le navigateur
npx playwright install chromium

# rejouer tous les scénarios (démarre un serveur PGlite éphémère, port 8788)
npm run test:e2e

# autre port / logs serveur
TEST_PORT=9000 E2E_DEBUG=1 npm run test:e2e
```

Aucun Docker requis : le serveur tourne sur **PGlite en mémoire** (DB neuve à
chaque exécution), Turnstile désactivé en local. Code de sortie 0 si tout passe.

## Scénarios (`e2e/scenarios.mjs`)

1. **boot** — l'app démarre, `#app` rendu, 0 erreur console/page, modules same-origin en 200.
2. **thème** — le toggle bascule `data-theme`.
3. **i18n** — passage en FR : `lang=fr` + libellés traduits.
4. **modale création** — s'ouvre avec les champs (ui/dom).
5. **création de compte** — `POST /api/identities` → 201 + clé.
6. **éditeur privé** — `/k/<clé>` rend l'éditeur (renderEditor + crypto E2E).

Chaque scénario est aussi soumis au garde-fou global : **toute** `console.error`,
erreur de page, ou réponse same-origin 4xx/5xx fait échouer le scénario.

## Ajouter un scénario

Pousser `{ name, async run(page, ctx) }` dans le tableau de `e2e/scenarios.mjs`.
`ctx` est partagé entre scénarios (la création de compte y dépose
`ctx.accessKey`, réutilisée par l'éditeur). `ctx.base` = URL de base.

## À couvrir manuellement (non automatisé)

Flux nécessitant 2 comptes / WebRTC / pièces jointes : messagerie chiffrée 1-1,
numéro de sécurité (parité Android), appels audio/vidéo, groupes, multi-appareils.
Voir la checklist navigateur complète fournie en session.
