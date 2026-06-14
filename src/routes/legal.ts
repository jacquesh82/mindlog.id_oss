// Pages légales publiques : mentions légales (LCEN art. 6-III), CGU,
// politique de confidentialité (RGPD) et CGV Premium (Stripe Connect).
//
// Identité de l'éditeur (personne morale) : renseignée via variables
// d'environnement pour ne pas figer des informations RCS / SIREN dans le code.
// Tant que LEGAL_EDITOR_NAME n'est pas défini, les pages affichent des
// marqueurs visibles "[À COMPLÉTER : …]" pour signaler le déploiement
// incomplet — il vaut mieux un placeholder voyant qu'une mention fausse.
//
// L'hébergeur OVHcloud est en dur : c'est un fait public stable et la LCEN
// impose qu'il soit identifié.

import { Hono } from "hono";

const route = new Hono();

const LAST_UPDATE = "2026-06-13";

const ENV = {
  name: process.env.LEGAL_EDITOR_NAME,
  form: process.env.LEGAL_EDITOR_FORM,
  capital: process.env.LEGAL_EDITOR_CAPITAL,
  rcs: process.env.LEGAL_EDITOR_RCS,
  siren: process.env.LEGAL_EDITOR_SIREN,
  vat: process.env.LEGAL_EDITOR_VAT,
  address: process.env.LEGAL_EDITOR_ADDRESS,
  email: process.env.LEGAL_EDITOR_EMAIL || "milo@mindlog.today",
  phone: process.env.LEGAL_EDITOR_PHONE,
  director: process.env.LEGAL_EDITOR_DIRECTOR,
  dpo: process.env.LEGAL_DPO_EMAIL,
};

const todo = (label: string) => `<mark style="background:#fff3a3;color:#5a4a00">[À COMPLÉTER : ${label}]</mark>`;
const v = (val: string | undefined, label: string) => (val?.trim() ? esc(val) : todo(label));

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Coquille HTML partagée — sobre, accessible, dark-mode auto, sans tracker.
function shell(title: string, h1: string, body: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · mindlog · id</title>
<meta name="robots" content="index,follow">
<style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:46rem;margin:2.5rem auto;padding:0 1.25rem;line-height:1.65;color:#1b2030}
h1{font-size:1.6rem;margin-bottom:.25rem}
h2{font-size:1.15rem;margin-top:2.25rem;border-top:1px solid #e3e6ee;padding-top:1.25rem}
h3{font-size:1rem;margin-top:1.5rem}
.meta{color:#666;font-size:.9rem;margin-bottom:2rem}
ul{padding-left:1.25rem}
li{margin:.25rem 0}
a{color:#2563eb}
code{background:#eef1f7;padding:.1rem .35rem;border-radius:4px;font-size:.9em}
nav.legal-nav{margin:1.5rem 0 0;padding:1rem;background:#f4f6fb;border-radius:8px;font-size:.95rem}
nav.legal-nav a{margin-right:1rem;display:inline-block}
.back{display:inline-block;margin-top:2rem;font-size:.9rem}
mark{padding:.1rem .35rem;border-radius:4px}
@media(prefers-color-scheme:dark){
  body{background:#0f1115;color:#e7e9ee}
  code{background:#20242e}
  h2{border-color:#2a2f3a}
  .meta{color:#a3a8b5}
  nav.legal-nav{background:#181c25}
}
</style></head>
<body>
<nav class="legal-nav" aria-label="Documents légaux">
  <a href="/mentions-legales">Mentions légales</a>
  <a href="/cgu">CGU</a>
  <a href="/confidentialite">Confidentialité</a>
  <a href="/cgv">CGV Premium</a>
</nav>
<h1>${esc(h1)}</h1>
<p class="meta">Dernière mise à jour : ${LAST_UPDATE} · Service <strong>mindlog · id</strong> — <a href="https://id.mindlog.today">id.mindlog.today</a></p>
${body}
<p class="back"><a href="/">← Retour à l'accueil</a></p>
</body></html>`;
}

/* ------------------------- Bloc identité éditeur ------------------------- */
// Réutilisé dans Mentions légales et CGV. Filtre les champs vides pour rester
// lisible si seulement le nom et l'adresse sont renseignés.
function editorBlock(): string {
  const lines: string[] = [];
  lines.push(`<strong>${v(ENV.name, "raison sociale")}</strong>${ENV.form ? `, ${esc(ENV.form)}` : todo("forme sociale")}`);
  if (ENV.capital) lines.push(`Capital social : ${esc(ENV.capital)}`);
  else lines.push(`Capital social : ${todo("capital")}`);
  lines.push(`RCS : ${v(ENV.rcs, "n° RCS + ville d'immatriculation")}`);
  lines.push(`SIREN : ${v(ENV.siren, "SIREN")}`);
  if (ENV.vat) lines.push(`N° TVA intracommunautaire : ${esc(ENV.vat)}`);
  lines.push(`Siège social : ${v(ENV.address, "adresse postale du siège")}`);
  lines.push(`Email : <a href="mailto:${esc(ENV.email)}">${esc(ENV.email)}</a>`);
  if (ENV.phone) lines.push(`Téléphone : ${esc(ENV.phone)}`);
  lines.push(`Directeur de la publication : ${v(ENV.director, "nom du dirigeant")}`);
  return `<p>${lines.join("<br>")}</p>`;
}

const HOST_BLOCK = `<p>
<strong>OVH SAS</strong><br>
2 rue Kellermann — 59100 Roubaix — France<br>
RCS Lille Métropole 424 761 419 — SIRET 424 761 419 00045<br>
Téléphone : 1007 (depuis la France) — <a href="https://www.ovhcloud.com">ovhcloud.com</a>
</p>`;

/* ============================ MENTIONS LÉGALES =========================== */

const MENTIONS = shell("Mentions légales", "Mentions légales", `
<p>Les présentes mentions légales sont publiées en application de l'article 6-III
de la loi n° 2004-575 du 21 juin 2004 pour la confiance dans l'économie numérique
(LCEN) et de l'article 19 de cette même loi.</p>

<h2>1. Éditeur du site</h2>
${editorBlock()}

<h2>2. Hébergeur</h2>
<p>Le site <strong>id.mindlog.today</strong> est hébergé par :</p>
${HOST_BLOCK}

<h2>3. Propriété intellectuelle</h2>
<p>Le code source de la plateforme est publié sous licence libre
<strong>GNU AGPL v3</strong> et accessible à l'adresse de son dépôt public.
Les marques, logos, dénominations et la mascotte « Milo » sont la propriété
de l'éditeur ; toute reproduction non autorisée est interdite.</p>

<p>Les <strong>contenus publiés par les utilisateurs</strong> (carte d'identité,
photo, galerie, événements d'agenda, pages d'espace Premium, messages) restent
la propriété exclusive de leurs auteurs. L'utilisateur concède à l'éditeur une
licence non exclusive, à titre gratuit, limitée à ce qui est strictement
nécessaire à l'exploitation du service (stockage, affichage aux destinataires
choisis, sauvegarde), pour la durée d'utilisation du service.</p>

<h2>4. Données personnelles</h2>
<p>Les conditions de traitement des données personnelles sont décrites dans
notre <a href="/confidentialite">Politique de confidentialité</a>.</p>

<h2>5. Cookies</h2>
<p>Le service n'utilise aucun cookie de mesure d'audience ni de publicité.
Seuls des cookies strictement nécessaires au fonctionnement (session
authentifiée, jeton CSRF) sont déposés ; ils sont dispensés du consentement
préalable en application de l'article 82 de la loi Informatique et Libertés.</p>

<h2>6. Signalement de contenu</h2>
<p>Tout contenu manifestement illicite peut être signalé à l'éditeur à
l'adresse <a href="mailto:${esc(ENV.email)}">${esc(ENV.email)}</a>, conformément
à la procédure prévue à l'article 6-I-5 de la LCEN. Le signalement doit
mentionner la date de la notification, l'identité du notifiant, la
description du contenu litigieux, son URL, et les motifs légaux justifiant
le retrait.</p>

<h2>7. Crédits</h2>
<p>Conception et développement : ${v(ENV.name, "éditeur")}. Mascotte « Milo » : mindlog · id.
Polices : <em>system-ui</em> (police système de l'utilisateur).</p>
`);

/* =================================== CGU ================================= */

const CGU = shell("Conditions Générales d'Utilisation", "Conditions Générales d'Utilisation", `
<p>Les présentes Conditions Générales d'Utilisation (« <strong>CGU</strong> »)
régissent l'accès et l'utilisation du service <strong>mindlog · id</strong>
(ci-après « le Service ») édité par ${v(ENV.name, "raison sociale")} (ci-après
« l'Éditeur »). Toute utilisation du Service vaut acceptation pleine et entière
des présentes CGU.</p>

<h2>Article 1 — Objet</h2>
<p>Le Service propose à toute personne physique (ci-après « l'Utilisateur »)
de créer une carte d'identité en ligne, de gérer un agenda et des
disponibilités, d'échanger des messages chiffrés de bout en bout, de gérer
ses relations et, le cas échéant, d'animer un Espace Premium accessible sur
abonnement (régi par les <a href="/cgv">CGV Premium</a>).</p>
<p><strong>Le Service n'a pas vocation à héberger de contenu à caractère
pornographique, érotique ou réservé à un public adulte (« +18 »)</strong>,
qu'il s'agisse de la partie publique de la carte (handle, attributs publics,
photo de profil, galerie, pages d'Espace Premium) ou de sa partie privée
(attributs réservés aux contacts ou strictement privés, exceptions
d'agenda). Aucune fonctionnalité de vérification d'âge des visiteurs n'est
mise en œuvre ; en conséquence, la publication de tels contenus est
strictement interdite (cf. article 4) et fait l'objet d'un retrait dès
constatation.</p>

<h2>Article 2 — Définitions</h2>
<ul>
  <li><strong>Compte</strong> : profil personnel d'un Utilisateur, identifié par un <em>handle</em> public et protégé par une clé d'accès secrète.</li>
  <li><strong>Carte</strong> : ensemble des attributs publics, contacts ou privés associés au Compte.</li>
  <li><strong>Espace Premium</strong> : ensemble de pages réservées publiées par un Utilisateur (« le Créateur ») et accessibles aux Abonnés via abonnement payant.</li>
  <li><strong>Contenu Utilisateur</strong> : toute donnée saisie, importée ou publiée par l'Utilisateur sur le Service.</li>
  <li><strong>Connecteur MCP</strong> : interface d'accès programmatique au Compte par un assistant d'intelligence artificielle, authentifiée par OAuth 2.1.</li>
</ul>

<h2>Article 3 — Inscription et sécurité du compte</h2>
<p>3.1. L'inscription est ouverte à toute personne physique âgée d'au moins
15 ans. Les utilisateurs mineurs reconnaissent avoir obtenu l'autorisation
préalable de leurs représentants légaux.</p>
<p>3.2. La création d'un Compte génère une <strong>clé d'accès</strong>
unique. Cette clé tient lieu d'identifiant et de mot de passe ; l'Utilisateur
est seul responsable de sa conservation et de sa confidentialité. Sa perte
peut entraîner la perte définitive de l'accès au Compte, l'Éditeur n'ayant
pas la capacité technique de la régénérer ni de récupérer les messages
chiffrés.</p>
<p>3.3. L'Utilisateur peut associer un email de récupération, une passkey
(WebAuthn) ou une passphrase au Compte. Il s'engage à ne pas partager ses
identifiants et à signaler sans délai toute utilisation non autorisée.</p>
<p>3.4. Un Utilisateur ne peut détenir qu'un seul Compte principal. L'Éditeur
se réserve le droit de fermer les Comptes multiples manifestement abusifs.</p>

<h2>Article 4 — Comportement et contenus interdits</h2>

<h3>4.1 — Contenus publiés sur les zones inspectables du Service</h3>
<p>Sont concernés : les attributs publics, contacts et privés de la carte,
le handle, la photo de profil, la galerie, les pages d'Espace Premium, les
événements d'agenda et toute autre donnée stockée en clair sur les serveurs
de l'Éditeur. Pour ces contenus, l'Utilisateur s'interdit en particulier :</p>
<ul>
  <li>de publier tout contenu illicite, notamment à caractère pédopornographique, terroriste, haineux, raciste, xénophobe, négationniste, diffamatoire, injurieux, contrefaisant ou portant atteinte à la vie privée d'autrui ;</li>
  <li>de publier tout contenu à caractère <strong>pornographique, érotique ou réservé à un public adulte (« +18 »)</strong>, le Service n'étant pas conçu pour héberger ce type de contenu et n'opérant aucune vérification d'âge des visiteurs ;</li>
  <li>d'usurper l'identité d'un tiers ou de publier des informations le concernant sans son consentement ;</li>
  <li>de promouvoir des produits ou services illégaux, ou d'utiliser le Service à des fins de prospection commerciale non sollicitée ;</li>
  <li>de tenter de contourner les mécanismes de sécurité, de surcharger le Service ou d'en perturber le fonctionnement ;</li>
  <li>de collecter automatiquement les données d'autres Utilisateurs sans leur consentement ;</li>
  <li>de revendre ou de transférer son Compte à un tiers.</li>
</ul>
<p>Tout manquement à la présente clause peut donner lieu, sans préavis, au
retrait du contenu, à la suspension ou à la résiliation du Compte (cf.
article 9).</p>

<h3>4.2 — Messages chiffrés de bout en bout</h3>
<p>Les messages échangés via le Service sont chiffrés de bout en bout
(protocole X3DH / Double Ratchet). <strong>L'Éditeur ne dispose d'aucun
moyen technique d'en prendre connaissance, de les indexer, de les analyser
ou de les modérer.</strong> Seuls l'expéditeur et le destinataire peuvent
les déchiffrer.</p>
<p>L'Utilisateur s'engage contractuellement à ne pas utiliser cette
fonctionnalité pour transmettre des contenus manifestement illicites,
notamment ceux énumérés au paragraphe 4.1. Ce ne peut être en aucun cas un
engagement de moyens de la part de l'Éditeur : la maîtrise du contenu
échangé relève exclusivement des correspondants, qui restent personnellement
et pénalement responsables de leurs envois.</p>
<p>La modération des messages relève des destinataires, qui peuvent à tout
moment bloquer leur expéditeur, supprimer la conversation et, le cas
échéant, conserver une copie déchiffrée pour signaler les faits aux
autorités compétentes (la conservation et la production des messages
déchiffrés relevant alors du seul destinataire).</p>

<h2>Article 5 — Modération et signalement</h2>
<p>5.1. Conformément à l'article 6-I-7 de la LCEN, l'Éditeur n'est pas
soumis à une obligation générale de surveillance des contenus stockés. Il
agit néanmoins promptement, sur signalement, pour retirer ou rendre
inaccessible tout contenu manifestement illicite figurant dans les zones
inspectables du Service (cf. article 4.1).</p>
<p>5.2. Tout signalement peut être adressé à
<a href="mailto:${esc(ENV.email)}">${esc(ENV.email)}</a> selon la procédure
prévue à l'article 6-I-5 de la LCEN, décrite aux mentions légales (article 6).
Le signalement doit identifier le contenu litigieux (URL, capture
d'écran, handle concerné) et exposer les motifs légaux du retrait demandé.</p>
<p>5.3. Concernant les messages chiffrés de bout en bout, l'Éditeur
rappelle qu'il n'a, par construction technique, aucun accès au contenu
échangé. La modération de ces messages relève exclusivement des
destinataires (cf. article 4.2). Les signalements concernant des messages
ne pourront donc être traités par l'Éditeur que sur production, par le
destinataire, du contenu déchiffré et de tout élément utile permettant
d'établir les faits.</p>

<h2>Article 6 — Propriété intellectuelle et licence d'exploitation</h2>
<p>6.1. L'Utilisateur conserve la pleine propriété de ses Contenus.</p>
<p>6.2. Il concède à l'Éditeur, pour la stricte exploitation du Service,
une licence non exclusive, gratuite, mondiale, comprenant le droit
d'héberger, reproduire, afficher et transmettre ses Contenus aux
destinataires choisis par l'Utilisateur lui-même. Cette licence prend fin
à la suppression du Contenu ou du Compte, sous réserve des sauvegardes
techniques temporaires.</p>
<p>6.3. Le code source du Service est publié sous licence GNU AGPL v3.</p>

<h2>Article 7 — Disponibilité du service</h2>
<p>L'Éditeur s'efforce d'assurer une disponibilité continue mais ne souscrit
à aucune obligation de résultat à cet égard. Le Service est fourni « en
l'état » ; des interruptions pour maintenance, mises à jour ou en cas de
force majeure peuvent survenir sans préavis. L'Éditeur ne saurait être tenu
responsable des préjudices indirects (perte de chance, perte de données,
manque à gagner) résultant d'une indisponibilité du Service.</p>

<h2>Article 8 — Limitation de responsabilité</h2>
<p>8.1. L'Éditeur assure principalement un rôle d'hébergeur technique au
sens de l'article 6-I-2 de la LCEN s'agissant des Contenus Utilisateur.</p>
<p>8.2. La responsabilité de l'Éditeur ne peut être engagée pour les
Contenus publiés par les Utilisateurs ni pour les comportements de tiers.</p>
<p>8.3. Sauf disposition impérative contraire, la responsabilité totale de
l'Éditeur à l'égard d'un Utilisateur, toutes causes confondues, est
plafonnée aux sommes effectivement versées à l'Éditeur par cet Utilisateur
au cours des douze (12) mois précédant le fait générateur. Pour un
Utilisateur gratuit, ce plafond est nul.</p>

<h2>Article 9 — Suspension et résiliation</h2>
<p>9.1. L'Utilisateur peut supprimer son Compte à tout moment depuis
l'éditeur ou via l'outil <code>delete_account</code> du Connecteur MCP. La
suppression entraîne l'effacement définitif des données associées, sous
réserve des conservations légales obligatoires.</p>
<p>9.2. L'Éditeur peut suspendre ou résilier un Compte, sans préavis ni
indemnité, en cas de manquement grave aux présentes CGU, de demande des
autorités compétentes, ou de comportement faisant peser un risque sur le
Service ou ses utilisateurs.</p>

<h2>Article 10 — Données personnelles</h2>
<p>Le traitement des données personnelles est décrit dans la
<a href="/confidentialite">Politique de confidentialité</a>, qui fait partie
intégrante des présentes CGU.</p>

<h2>Article 11 — Modification des CGU</h2>
<p>L'Éditeur peut modifier les présentes CGU à tout moment. Les modifications
substantielles sont notifiées à l'Utilisateur par tout moyen approprié, au
moins quinze (15) jours avant leur entrée en vigueur. L'usage continu du
Service après cette date vaut acceptation des CGU modifiées.</p>

<h2>Article 12 — Droit applicable et juridiction</h2>
<p>Les présentes CGU sont régies par le droit français. À défaut de
résolution amiable, tout différend relève des tribunaux compétents du ressort
du siège social de l'Éditeur, sauf disposition impérative contraire
(notamment le droit du consommateur attribuant compétence au tribunal du
domicile du consommateur).</p>

<h2>Article 13 — Contact</h2>
<p>Pour toute question relative aux présentes CGU :
<a href="mailto:${esc(ENV.email)}">${esc(ENV.email)}</a>.</p>
`);

/* ====================== POLITIQUE DE CONFIDENTIALITÉ ===================== */

const dpoEmail = ENV.dpo || ENV.email;

const CONFIDENTIALITE = shell("Politique de confidentialité", "Politique de confidentialité", `
<p>La présente politique décrit la façon dont l'Éditeur traite les données à
caractère personnel des Utilisateurs du Service, conformément au Règlement
général sur la protection des données (RGPD — UE 2016/679) et à la loi
n° 78-17 du 6 janvier 1978 modifiée (Informatique et Libertés).</p>

<h2>1. Responsable du traitement</h2>
${editorBlock()}
<p>Contact dédié à la protection des données :
<a href="mailto:${esc(dpoEmail)}">${esc(dpoEmail)}</a>.</p>

<h2>2. Données collectées</h2>
<p><strong>Données de profil</strong> : handle public, attributs de carte
(public / contacts / privé selon le classement de l'Utilisateur), tags,
photo de profil, galerie, événements d'agenda, exceptions de disponibilité,
relations entre profils, demandes de rendez-vous.</p>
<p><strong>Données d'authentification</strong> : empreinte (hachage) de la
clé d'accès, identifiants de session (cookie <code>HttpOnly</code>),
identifiants de passkeys WebAuthn (empreintes uniquement), jetons OAuth
(empreintes uniquement). Aucun secret n'est stocké en clair.</p>
<p><strong>Email de récupération</strong> (facultatif) : adresse email
permettant de récupérer l'accès en cas de perte de la clé.</p>
<p><strong>Messages</strong> : chiffrés de bout en bout (protocole X3DH /
Double Ratchet). Le serveur ne stocke que des données chiffrées qu'il ne
peut pas lire — il ne dispose donc pas du contenu en clair.</p>
<p><strong>Données techniques</strong> : adresse IP de connexion (transitoire,
journalisée à des fins de sécurité), agent utilisateur, horodatages.</p>
<p><strong>Données de paiement</strong> (si abonnement Premium) : aucune
donnée bancaire n'est transmise ni stockée par l'Éditeur ; le paiement est
intégralement délégué à Stripe (cf. § 5).</p>

<h2>3. Finalités et bases légales</h2>
<table style="border-collapse:collapse;width:100%;margin:.5rem 0">
  <thead><tr><th align="left" style="border-bottom:1px solid #ccc;padding:.3rem">Finalité</th><th align="left" style="border-bottom:1px solid #ccc;padding:.3rem">Base légale (RGPD art. 6)</th></tr></thead>
  <tbody>
    <tr><td style="padding:.3rem">Fourniture du Service (compte, agenda, messagerie, relations)</td><td style="padding:.3rem">Exécution du contrat (a. 6.1.b)</td></tr>
    <tr><td style="padding:.3rem">Sécurité, lutte contre la fraude et abus</td><td style="padding:.3rem">Intérêt légitime (a. 6.1.f)</td></tr>
    <tr><td style="padding:.3rem">Notifications transactionnelles et de récupération</td><td style="padding:.3rem">Exécution du contrat (a. 6.1.b)</td></tr>
    <tr><td style="padding:.3rem">Facturation des abonnements Premium</td><td style="padding:.3rem">Exécution du contrat + obligation légale (a. 6.1.b et c)</td></tr>
    <tr><td style="padding:.3rem">Réponse aux réquisitions judiciaires</td><td style="padding:.3rem">Obligation légale (a. 6.1.c)</td></tr>
    <tr><td style="padding:.3rem">Connecteur MCP / accès IA</td><td style="padding:.3rem">Consentement (a. 6.1.a), révocable</td></tr>
  </tbody>
</table>

<h2>4. Durées de conservation</h2>
<ul>
  <li>Données de Compte : tant que le Compte est actif, puis supprimées en cas de fermeture.</li>
  <li>Messages éphémères : supprimés automatiquement au-delà de leur durée de vie (par défaut 24 h).</li>
  <li>Sessions et jetons OAuth expirés : purgés automatiquement.</li>
  <li>Données de facturation : conservées 10 ans à compter de l'émission (article L123-22 du Code de commerce).</li>
  <li>Journaux techniques (IP, horodatages) : 12 mois maximum, conformément à l'article L34-1 du CPCE.</li>
</ul>

<h2>5. Sous-traitants et destinataires</h2>
<p>Aucune donnée n'est cédée ni revendue. Des sous-traitants techniques
intervenant pour le compte de l'Éditeur peuvent traiter certaines données :</p>
<ul>
  <li><strong>OVHcloud</strong> (France) — hébergement infrastructure et base de données.</li>
  <li><strong>Stripe Payments Europe, Ltd.</strong> (Irlande) — traitement des paiements et gestion des abonnements Premium ; certaines opérations peuvent impliquer Stripe, Inc. (États-Unis), sur la base des Clauses contractuelles types adoptées par la Commission européenne et du Data Privacy Framework.</li>
  <li><strong>Serveur SMTP</strong> (si configuré) — envoi des emails transactionnels.</li>
  <li><strong>Cloudflare</strong> (si Turnstile activé) — anti-robot lors de la création de compte/page.</li>
</ul>

<h2>6. Transferts hors Union européenne</h2>
<p>Les données sont hébergées en France. Les seuls transferts hors UE
possibles concernent Stripe (États-Unis), encadrés par les Clauses
contractuelles types et le Data Privacy Framework. L'Utilisateur peut
demander une copie des garanties à l'adresse
<a href="mailto:${esc(dpoEmail)}">${esc(dpoEmail)}</a>.</p>

<h2>7. Sécurité</h2>
<p>L'Éditeur met en œuvre des mesures techniques et organisationnelles
appropriées : chiffrement de bout en bout des messages, hachage des secrets
d'authentification, chiffrement en transit (TLS), protection CSRF,
limitation de débit, journalisation de sécurité, principe du moindre
privilège. Aucun système n'est inviolable ; une faille éventuelle exposant
des données personnelles serait notifiée à la CNIL et, le cas échéant, aux
personnes concernées dans les conditions prévues aux articles 33 et 34 du
RGPD.</p>

<h2>8. Vos droits</h2>
<p>Conformément aux articles 15 à 22 du RGPD, vous disposez des droits
suivants sur vos données :</p>
<ul>
  <li><strong>Accès</strong> — obtenir une copie de vos données (export disponible via <code>GET /api/me/export</code>).</li>
  <li><strong>Rectification</strong> — corriger toute donnée inexacte directement depuis l'éditeur.</li>
  <li><strong>Effacement</strong> — supprimer votre Compte à tout moment ; l'effacement est définitif.</li>
  <li><strong>Opposition</strong> — vous opposer à un traitement fondé sur l'intérêt légitime.</li>
  <li><strong>Portabilité</strong> — recevoir vos données dans un format structuré et lisible par machine.</li>
  <li><strong>Limitation</strong> — demander la limitation d'un traitement contesté.</li>
  <li><strong>Retrait du consentement</strong> — révoquer à tout moment un consentement précédemment donné (Connecteur MCP, email de récupération…).</li>
  <li><strong>Directives post-mortem</strong> — définir le sort de vos données après votre décès (article 85 LIL).</li>
</ul>
<p>Pour exercer vos droits :
<a href="mailto:${esc(dpoEmail)}">${esc(dpoEmail)}</a>.</p>

<h2>9. Réclamation auprès de la CNIL</h2>
<p>Si vous estimez que vos droits ne sont pas respectés, vous pouvez
introduire une réclamation auprès de la Commission nationale de
l'informatique et des libertés (CNIL — 3 place de Fontenoy, TSA 80715,
75334 Paris cedex 07 — <a href="https://www.cnil.fr">cnil.fr</a>).</p>

<h2>10. Cookies</h2>
<p>Seuls des cookies strictement nécessaires sont déposés :</p>
<ul>
  <li><code>session</code> — cookie d'authentification, <em>HttpOnly</em> et <em>Secure</em>, durée de vie ~30 jours.</li>
  <li>Jeton CSRF — anti-falsification de requête, lié à la session.</li>
</ul>
<p>Aucun cookie publicitaire, de mesure d'audience tierce ou de pistage
n'est utilisé. Ces cookies sont dispensés du recueil de consentement
préalable conformément à l'article 82 de la loi Informatique et Libertés.</p>

<h2>11. Modifications de la politique</h2>
<p>La présente politique peut être mise à jour. La date en tête de page
indique la dernière révision. Les modifications substantielles sont
notifiées par tout moyen approprié.</p>
`);

/* ============================== CGV PREMIUM ============================== */

const CGV = shell("CGV Premium", "Conditions Générales de Vente — Espaces Premium", `
<p>Les présentes Conditions Générales de Vente (« <strong>CGV</strong> »)
régissent la souscription aux abonnements Premium proposés par les
Créateurs sur le Service <strong>mindlog · id</strong> (ci-après « la
Plateforme »). Elles complètent les <a href="/cgu">CGU</a>, sans s'y
substituer.</p>

<h2>Article 1 — Identité des parties</h2>
<p><strong>Éditeur de la Plateforme</strong> (intermédiaire technique) :</p>
${editorBlock()}
<p><strong>Vendeur</strong> : le Créateur de l'Espace Premium auquel
l'Abonné souscrit. Le Créateur est identifié sur sa page publique
(<code>/@handle</code>) et dispose d'un compte Stripe Connect propre, sur
lequel l'Abonné est facturé en direct (modèle <em>direct charges</em>).
L'Éditeur perçoit, à ce titre, une commission technique de
<strong>30 %</strong> par transaction (frais de plateforme).</p>

<h2>Article 2 — Définitions</h2>
<ul>
  <li><strong>Abonné</strong> : Utilisateur souscrivant à un abonnement Premium.</li>
  <li><strong>Créateur</strong> : Utilisateur publiant un Espace Premium et fixant le prix mensuel d'abonnement.</li>
  <li><strong>Espace Premium</strong> : ensemble de pages réservées du Créateur (texte, galerie, lien, fichier) accessibles aux Abonnés.</li>
  <li><strong>Abonnement</strong> : engagement mensuel renouvelable par tacite reconduction donnant accès à l'intégralité de l'Espace Premium du Créateur concerné.</li>
</ul>

<h2>Article 3 — Caractéristiques essentielles</h2>
<p>L'Abonnement donne accès, pour la durée mensuelle souscrite, à toutes
les pages Premium du Créateur, y compris celles qu'il publie pendant cette
période. Le nombre, la nature et la fréquence de publication des pages
Premium sont déterminés par le seul Créateur ; la Plateforme ne garantit
aucun volume minimal de contenu.</p>

<h2>Article 4 — Prix, paiement, facturation</h2>
<p>4.1. Le prix mensuel TTC est affiché en euros sur la page publique du
Créateur avant souscription. Les éventuelles taxes applicables sont
indiquées dans le récapitulatif de paiement.</p>
<p>4.2. Le paiement est traité par <strong>Stripe Payments Europe, Ltd.</strong>.
L'Abonné est facturé en direct par le Créateur via son compte Stripe Connect
propre. Aucune donnée bancaire ne transite par les serveurs de la Plateforme.</p>
<p>4.3. L'Abonné reçoit un reçu de paiement à chaque échéance, à l'adresse
email associée à son compte Stripe.</p>

<h2>Article 5 — Reconduction tacite</h2>
<p>L'Abonnement se renouvelle automatiquement à chaque date d'anniversaire
mensuelle, sauf résiliation par l'Abonné avant cette date (cf. article 7).
Conformément aux articles L215-1 et L215-1-1 du Code de la consommation,
l'Abonné peut résilier sans frais à tout moment en quelques clics depuis
son espace.</p>

<h2>Article 6 — Droit de rétractation et renonciation expresse</h2>
<p>6.1. En application de l'article L221-18 du Code de la consommation,
l'Abonné consommateur dispose d'un délai de quatorze (14) jours pour se
rétracter sans motif après la souscription.</p>
<p>6.2. <strong>Renonciation expresse au droit de rétractation pour les
contenus numériques fournis immédiatement</strong> — Conformément à
l'article L221-28, 13° du même Code, l'Abonné, en validant sa souscription,
demande l'exécution immédiate de la prestation et reconnaît expressément
perdre son droit de rétractation dès que l'accès aux contenus Premium est
ouvert. Une case dédiée doit être cochée lors de la souscription pour
matérialiser cet accord.</p>
<p>6.3. Tant que l'accès n'a pas été ouvert, l'Abonné peut exercer son
droit de rétractation par tout moyen non équivoque, notamment en utilisant
le modèle de formulaire de l'annexe à l'article R221-1 du Code de la
consommation, à l'adresse <a href="mailto:${esc(ENV.email)}">${esc(ENV.email)}</a>.</p>

<h2>Article 7 — Résiliation par l'Abonné</h2>
<p>L'Abonné peut résilier son Abonnement à tout moment depuis son espace.
La résiliation prend effet à la fin de la période mensuelle en cours :
l'accès aux contenus Premium est maintenu jusqu'à cette échéance, sans
remboursement au prorata.</p>

<h2>Article 8 — Résiliation par le Créateur ou la Plateforme</h2>
<p>8.1. Le Créateur peut fermer son Espace Premium à tout moment. Dans ce
cas, les abonnements en cours sont automatiquement annulés et l'Abonné est
remboursé au prorata des jours non consommés, lorsque cela est techniquement
possible via Stripe.</p>
<p>8.2. La Plateforme peut suspendre ou clôturer un Espace Premium en cas
de manquement grave aux CGU, notamment publication de contenus illicites,
fraude, ou défaut de conformité du compte Stripe Connect.</p>

<h2>Article 9 — Responsabilités</h2>
<p>9.1. La Plateforme assure exclusivement un rôle d'intermédiaire
technique : mise à disposition de l'outil de publication, encaissement
délégué via Stripe Connect, gestion technique des accès. Elle n'édite pas
le contenu Premium et n'en garantit ni la qualité, ni la quantité, ni
l'adéquation à un usage particulier.</p>
<p>9.2. Le Créateur est seul responsable du contenu de son Espace Premium,
de sa conformité aux lois en vigueur, de la collecte et de la déclaration
des taxes applicables à son activité (TVA, impôts sur les revenus, etc.),
et de la délivrance d'une éventuelle facture lorsque la loi l'y oblige.</p>
<p>9.3. La responsabilité de la Plateforme à l'égard d'un Abonné, toutes
causes confondues, est plafonnée au montant des frais de plateforme
effectivement perçus sur cet Abonné au cours des douze (12) derniers mois.</p>

<h2>Article 10 — Garantie légale de conformité</h2>
<p>L'Abonné consommateur bénéficie, le cas échéant, des garanties légales
de conformité (articles L217-3 et suivants du Code de la consommation) et
contre les vices cachés (articles 1641 et suivants du Code civil)
applicables aux contenus numériques. Toute réclamation peut être adressée
au Créateur et, à titre subsidiaire, à la Plateforme via
<a href="mailto:${esc(ENV.email)}">${esc(ENV.email)}</a>.</p>

<h2>Article 11 — Médiation de la consommation</h2>
<p>Conformément à l'article L612-1 du Code de la consommation, le
consommateur a la possibilité de recourir gratuitement à un médiateur de
la consommation en vue de la résolution amiable d'un litige. Le médiateur
désigné par la Plateforme est :
${v(process.env.LEGAL_MEDIATOR_NAME, "nom du médiateur conso")} —
${v(process.env.LEGAL_MEDIATOR_URL, "URL du site du médiateur")}.</p>
<p>La Commission européenne met également à disposition une plateforme de
règlement en ligne des litiges :
<a href="https://ec.europa.eu/consumers/odr">ec.europa.eu/consumers/odr</a>.</p>

<h2>Article 12 — Modification du prix</h2>
<p>Le Créateur peut modifier le prix mensuel de son Espace Premium pour
l'avenir. Les Abonnés existants sont informés au moins trente (30) jours
avant la prise d'effet du nouveau prix et peuvent résilier sans frais
avant cette date ; à défaut de résiliation, le nouveau prix s'applique au
renouvellement suivant.</p>

<h2>Article 13 — Données personnelles</h2>
<p>Le traitement des données liées à l'Abonnement est décrit dans la
<a href="/confidentialite">Politique de confidentialité</a>. Stripe est
sous-traitant pour le paiement ; le Créateur est destinataire d'un
identifiant pseudonyme de l'Abonné et de la facturation associée.</p>

<h2>Article 14 — Loi applicable et juridiction</h2>
<p>Les présentes CGV sont régies par le droit français. Pour l'Abonné
consommateur, conformément à l'article R631-3 du Code de la consommation,
les tribunaux compétents sont, au choix de celui-ci, ceux du lieu où il
demeurait au moment de la conclusion du contrat ou du fait dommageable.</p>

<h2>Article 15 — Contact</h2>
<p><a href="mailto:${esc(ENV.email)}">${esc(ENV.email)}</a></p>
`);

/* ----------------------------- Routes Hono ------------------------------ */

const CACHE = "public, max-age=3600";

route.get("/mentions-legales", (c) => { c.header("Cache-Control", CACHE); return c.html(MENTIONS); });
route.get("/cgu", (c) => { c.header("Cache-Control", CACHE); return c.html(CGU); });
route.get("/confidentialite", (c) => { c.header("Cache-Control", CACHE); return c.html(CONFIDENTIALITE); });
route.get("/cgv", (c) => { c.header("Cache-Control", CACHE); return c.html(CGV); });

// Anciens chemins → redirections permanentes vers les nouveaux.
route.get("/privacy", (c) => c.redirect("/confidentialite", 301));
route.get("/legal", (c) => c.redirect("/mentions-legales", 301));

export default route;
