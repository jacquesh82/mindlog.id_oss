# Stripe — bascule Test → Live

Procédure pour passer la facturation Stripe du **mode test** (dev local) au **mode live** (prod str01).

## Convention par environnement

| Environnement | URL | Mode Stripe | Source des secrets |
|---|---|---|---|
| Dev local | `https://id.mindlog.localhost` | **Test** | `.env` à la racine du repo (gitignored) |
| Prod | `https://id.mindlog.today` | **Live** | `/app/mindlog.id/.env` **sur str01** (jamais dans le dépôt) |

Le code source est strictement identique dans les deux environnements — c'est uniquement la valeur des variables `STRIPE_*` qui décide test ou live.

## Variables concernées

| Variable | Test (`.env` repo) | Live (`.env` str01) |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` | `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` généré par `stripe listen` | `whsec_…` du webhook dashboard live |
| `STRIPE_PRICE_PREMIUM` | `price_…` test du Premium global | `price_…` **live** (objet différent) |

`MINDLOG_DEV_PREMIUM` ne sert qu'en dev (gated par `NODE_ENV !== "production"`) — laisser absent ou à `0` en prod.

## Vue d'ensemble

```
        DEV LOCAL                                    PROD
   ───────────────────                       ─────────────────────
   .env (repo)                               /app/mindlog.id/.env
   sk_test_… / whsec_… test                  sk_live_… / whsec_… live
        │                                            │
        ▼                                            ▼
   tsx watch src/server.ts                   docker compose (str01)
        │                                            │
        ▼                                            ▼
   api.stripe.com (test data)                api.stripe.com (live data)
        ▲                                            ▲
        │ events                                     │ events
   stripe listen --forward-to                Stripe POST direct sur
   localhost:8787/api/billing/webhook        https://id.mindlog.today/api/billing/webhook
```

## Côté Stripe — préparer le compte live

### 1. Activer le compte live
<https://dashboard.stripe.com/account/onboarding>
- Bascule **Test → Live** (toggle dashboard).
- Remplir : statut juridique (SAS, micro, EI…), SIRET, RIB pour payouts, KYC représentant légal.
- Validation Stripe : quelques heures à quelques jours.

### 2. Connect platform profile (mode live)
<https://dashboard.stripe.com/settings/connect/platform-profile>
- Re-valider le profil plateforme **en mode live** (le test ne se réplique pas).
- Accepter à nouveau la responsabilité de gestion des pertes (Option A, [cf. choix Connect](#référence-choix-architecture-connect)).
- Activer Express : <https://dashboard.stripe.com/settings/connect/express>.

### 3. Créer le Product + Price live du Premium global
Test mode et live mode sont **deux mondes Stripe distincts** : le `price_…` de test n'existe pas en live.

Soit via le dashboard <https://dashboard.stripe.com/products>, soit via curl :
```bash
SK_LIVE="sk_live_…"
PROD=$(curl -s -X POST https://api.stripe.com/v1/products -u "${SK_LIVE}:" \
  --data-urlencode 'name=mindlog Premium' \
  --data-urlencode 'description=Access to creator tools (private chat/visio, live streams, premium pages, etc.)' \
  -d 'metadata[kind]=premium_global')
PROD_ID=$(echo "$PROD" | jq -r .id)
PRICE=$(curl -s -X POST https://api.stripe.com/v1/prices -u "${SK_LIVE}:" \
  -d "product=${PROD_ID}" \
  -d "unit_amount=99" \
  -d "currency=eur" \
  -d "recurring[interval]=month" \
  -d 'metadata[kind]=premium_global')
echo "STRIPE_PRICE_PREMIUM=$(echo "$PRICE" | jq -r .id)"
```

### 4. Créer le webhook endpoint live
<https://dashboard.stripe.com/webhooks> en mode Live → **Add endpoint**.

| Champ | Valeur |
|---|---|
| URL | `https://id.mindlog.today/api/billing/webhook` |
| Events | `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `account.updated`, `invoice.payment_failed` |
| Listen on connected accounts | **coché** (sinon les events des espaces créateurs ne reviennent jamais) |

Récupérer le **Signing secret** `whsec_…` → c'est la valeur de `STRIPE_WEBHOOK_SECRET` côté prod.

⚠️ **Pas de `stripe listen` en prod**. Cet outil sert uniquement au dev local (le PC du dev n'a pas d'IP publique). En live, Stripe POST directement sur l'endpoint public.

## Côté str01 — injection des secrets

Le déploiement actuel garde le `.env` **sur l'hôte str01** (à côté de `docker-compose.prod.yml`). La CI GitHub Actions ne touche que SSH/GHCR — elle n'injecte aucun secret runtime. C'est volontaire (les `sk_live_…` ne transitent jamais par GHA).

### Procédure de bascule (première fois ou rotation)

```bash
ssh debian@str01
cd /app/mindlog.id
cp .env .env.bak-$(date +%F)         # backup avant édition

# Éditer .env et renseigner / mettre à jour :
#   STRIPE_SECRET_KEY=sk_live_…
#   STRIPE_WEBHOOK_SECRET=whsec_…
#   STRIPE_PRICE_PREMIUM=price_…
#   (supprimer ou commenter MINDLOG_DEV_PREMIUM si présent)
nano .env

# Recharger l'app pour que les nouvelles env vars soient lues
docker compose -f docker-compose.prod.yml up -d --force-recreate app
docker compose -f docker-compose.prod.yml logs -f app | head -50
```

Vérification rapide :
```bash
curl -sk -o /dev/null -w "%{http_code}\n" -X POST \
  https://id.mindlog.today/api/billing/webhook -d '{}'   # → 400 (signature invalide, attendu)
curl -sk https://id.mindlog.today/api/premium/upsell      # → JSON, non 503
```

### Et GitHub Actions ?

Aucune modif de `.github/workflows/release.yml` requise pour le passage en live — le `.env` de str01 n'est pas géré par la CI.

Deux évolutions possibles si on veut centraliser plus tard (non requis aujourd'hui) :

| Option | Bénéfice | Coût |
|---|---|---|
| Mettre `STRIPE_LIVE_*` dans **GitHub Actions secrets** + injecter via `appleboy/ssh-action` au déploiement (sed/upsert dans `.env`) | rotation depuis l'UI GitHub, audit log GitHub | une étape de plus à scripter dans `release.yml`, secrets dupliqués entre GHA et str01 |
| Migrer vers un **vault** (Bitwarden / 1Password / Doppler) + sync au déploiement | source unique de vérité, partage équipe | dépendance externe à mettre en place |

Aujourd'hui les secrets vivent uniquement sur str01 → **rien à toucher côté GHA**.

## Checklist de bascule

Avant d'ouvrir le paiement réel au public :

- [ ] Compte Stripe activé en live (étape 1)
- [ ] Connect platform profile **live** validé + Express activé (étape 2)
- [ ] Product + Price live créés (étape 3), `STRIPE_PRICE_PREMIUM` noté
- [ ] Webhook endpoint live créé avec "Connected accounts" coché (étape 4), `whsec_…` noté
- [ ] `.env` str01 mis à jour avec les 3 valeurs live, app redémarrée (procédure ci-dessus)
- [ ] Mentions légales site (SIRET, contact) accessibles
- [ ] CGU + politique de confidentialité publiées (URLs renseignées dans Stripe Checkout settings)
- [ ] Décision TVA prise (Stripe Tax activé ou mention "TVA non applicable — art. 293 B")
- [ ] Test end-to-end avec une **vraie carte** (somme symbolique) → encaissement + webhook + ligne `subscriptions` en base
- [ ] Test de remboursement depuis dashboard → webhook `customer.subscription.deleted` reçu, `subscriptions.status=canceled`
- [ ] `MINDLOG_DEV_PREMIUM` retiré du `.env` prod (par sécurité, même si gated par `NODE_ENV`)

## Et les créateurs (Connect Express live) ?

Aucune action côté code. Chaque créateur qui voudra être payé devra **refaire son onboarding Express en live** la première fois — c'est un KYC réel (pièce d'identité, RIB, justificatifs au-dessus d'un certain volume).

Le flow d'onboarding existant (`createConnectAccount` → `createConnectOnboardingLink` dans `src/premium/billing.ts`) marche identiquement en live ; seule la clé secrète change.

Conséquence côté base : la colonne `connect_accounts.stripe_account_id` d'un créateur **test** sera remplacée par un nouvel `acct_…` **live** quand il refera l'onboarding sur la prod. Les comptes test et live sont totalement étanches.

## Référence — choix architecture Connect

Le code utilise **direct charges (Option A)** :
- Charge créée sur le compte du créateur (`Stripe-Account: acct_xxx`)
- mindlog encaisse une `application_fee_percent: 30`
- Le créateur apparaît sur le reçu et gère ses litiges (avantage : créateurs monde entier, 46 pays)

`transfer_data[destination]` (Option B) a été retiré du code. Si on souhaitait un jour repasser en B (mindlog sur le reçu, EU/UK only), il faudrait restaurer ce champ et retirer le header `Stripe-Account` — voir `src/premium/billing.ts::stripeApi` et les 3 builders Checkout.

## Références

- `src/premium/billing.ts` — toutes les fonctions Stripe (Connect direct charges)
- `src/premium/routes/billing.ts` — routes `/api/billing/*` (checkout, portal, webhook)
- `src/premium/routes/page.ts` — routes `/api/space/:handle/subscribe`, `/api/pages/:handle/:slug/checkout`
- `docs/deploy-str01.md` — architecture de déploiement détaillée
- `docs/premium-offer-plan.md` — modèle métier Premium
- `.env.example` — toutes les variables d'environnement documentées
