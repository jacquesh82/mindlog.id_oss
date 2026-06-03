import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import mjml2html from "mjml";
import { appUrl } from "./mailer.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const MILO_B64 = `data:image/png;base64,${readFileSync(join(__dir, "../public/milo.png")).toString("base64")}`;

/**
 * Gabarits d'emails de la plateforme, mis en forme avec MJML.
 * Look & feel proche du site (thème sombre, accent caméléon) et voix de Milo,
 * la mascotte : tous les emails sont « envoyés par Milo 🦎 ».
 */

// Palette alignée sur le site (public/style.css). Le caméléon Milo = vert.
const C = {
  bg: "#0f1115",
  card: "#171a21",
  line: "#262b36",
  fg: "#e7e9ee",
  muted: "#8b93a3",
  accent: "#5fd39a", // vert caméléon
  onAccent: "#0b0d12",
};

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const ESC_HTML: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC_HTML[c] ?? c);

export interface Email {
  subject: string;
  text: string;
  html: string;
}

/**
 * Gabarit commun : en-tête Milo, contenu, bouton d'action, pied de page.
 * `bodyHtml` est inséré tel quel (déjà échappé par l'appelant).
 */
async function layout(opts: {
  preview: string;
  heading: string;
  intro: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  note?: string;
}): Promise<string> {
  const site = appUrl();
  const mjml = `
<mjml>
  <mj-head>
    <mj-title>${esc(opts.heading)}</mj-title>
    <mj-preview>${esc(opts.preview)}</mj-preview>
    <mj-attributes>
      <mj-all font-family="${FONT}" />
      <mj-text font-size="15px" line-height="1.6" color="${C.fg}" />
    </mj-attributes>
    <mj-style>
      a { color: ${C.accent}; }
      .pill { background:${C.bg}; border:1px solid ${C.line}; border-radius:999px; }
    </mj-style>
  </mj-head>
  <mj-body background-color="${C.bg}" width="480px">
    <mj-section padding="28px 0 8px">
      <mj-column>
        <mj-image src="${MILO_B64}" width="72px" alt="Milo 🦎" padding="0 0 6px" />
        <mj-text align="center" color="${C.accent}" font-size="18px" font-weight="700" padding="0">
          Milo · mindlog <span style="color:${C.muted};font-weight:400">id</span>
        </mj-text>
      </mj-column>
    </mj-section>

    <mj-section background-color="${C.card}" border="1px solid ${C.line}" border-radius="14px" padding="24px" css-class="card">
      <mj-column>
        <mj-text font-size="20px" font-weight="700" padding="0 0 6px">${esc(opts.heading)}</mj-text>
        <mj-text color="${C.fg}" padding="0 0 14px">${opts.intro}</mj-text>
        ${opts.bodyHtml}
        <mj-button background-color="${C.accent}" color="${C.onAccent}" font-weight="700" border-radius="10px" inner-padding="12px 22px" href="${esc(opts.ctaUrl)}" padding="18px 0 6px">
          ${esc(opts.ctaLabel)}
        </mj-button>
        ${opts.note ? `<mj-text color="${C.muted}" font-size="13px" padding="10px 0 0">${opts.note}</mj-text>` : ""}
      </mj-column>
    </mj-section>

    <mj-section padding="14px 0 28px">
      <mj-column>
        <mj-text align="center" color="${C.muted}" font-size="12px" line-height="1.7">
          Cet email t'est envoyé par <strong style="color:${C.accent}">Milo</strong> 🦎, la mascotte de
          <a href="${esc(site)}">mindlog · id</a>.<br />
          Une carte d'identité en ligne, simple et épurée · <a href="https://le-lab.net">le-lab.net</a>
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
  const { html } = await mjml2html(mjml, { validationLevel: "soft", minify: true });
  return html;
}

/** Email de récupération : nouveau lien privé après perte de clé. */
export async function recoveryEmail(handle: string, link: string): Promise<Email> {
  const h = esc(handle);
  return {
    subject: "🦎 Ton nouveau lien d'accès — mindlog · id",
    text:
      `Coucou, c'est Milo 🦎 !\n\n` +
      `Tu as demandé un nouveau lien privé pour @${handle}. Le voici :\n${link}\n\n` +
      `L'ancienne clé ne fonctionne plus. Garde ce lien précieusement — c'est ta seule clé d'écriture.\n\n` +
      `À bientôt sur ${appUrl()} 🦎`,
    html: await layout({
      preview: `Ton nouveau lien privé pour @${handle}`,
      heading: "Ton nouvel accès est prêt",
      intro: `Coucou, c'est <strong style="color:${C.accent}">Milo</strong> 🦎 ! Tu as demandé un nouveau lien privé pour <strong>@${h}</strong>. Le voici :`,
      bodyHtml: `<mj-text css-class="pill" padding="10px 14px" font-size="13px" color="${C.muted}"><a href="${esc(link)}" style="word-break:break-all">${esc(link)}</a></mj-text>`,
      ctaLabel: "Ouvrir mon espace",
      ctaUrl: link,
      note: "L'ancienne clé ne fonctionne plus. Garde ce lien précieusement — c'est ta seule clé d'écriture.",
    }),
  };
}

/**
 * Email de bienvenue : page créée (par la personne elle-même ou automatiquement
 * suite à une demande de RDV). Contient le lien public (à partager) et le lien
 * privé avec la clé (seul accès en écriture, à garder précieusement).
 */
export async function welcomeEmail(
  handle: string,
  privateLink: string,
  publicLink: string
): Promise<Email> {
  const h = esc(handle);
  return {
    subject: "🦎 Ta page mindlog · id est prête — chat E2E inclus",
    text:
      `Coucou, c'est Milo 🦎 !\n\n` +
      `Une page mindlog · id vient d'être créée pour toi sous le handle @${handle}.\n\n` +
      `• Ton lien public (à partager) :\n${publicLink}\n` +
      `• Ton lien privé avec la clé (garde-le précieusement) :\n${privateLink}\n\n` +
      `Avec cette page tu peux :\n` +
      `• Partager ta carte d'identité en ligne\n` +
      `• Discuter en chat chiffré de bout en bout (E2E) avec tes contacts\n` +
      `• Gérer tes disponibilités et demandes de RDV\n\n` +
      `À bientôt sur ${appUrl()} 🦎`,
    html: await layout({
      preview: `Ta page @${handle} est prête — lien public + lien privé`,
      heading: "Bienvenue sur mindlog · id ! 🎉",
      intro: `Coucou, c'est <strong style="color:${C.accent}">Milo</strong> 🦎 ! Une page vient d'être créée pour <strong>@${h}</strong>. Voici tes deux liens :`,
      bodyHtml: `
        <mj-text color="${C.fg}" font-size="13px" font-weight="700" padding="6px 0 4px">🪪 Lien public (à partager)</mj-text>
        <mj-text css-class="pill" padding="10px 14px" font-size="13px" color="${C.muted}"><a href="${esc(publicLink)}" style="word-break:break-all">${esc(publicLink)}</a></mj-text>
        <mj-text color="${C.fg}" font-size="13px" font-weight="700" padding="14px 0 4px">🔑 Lien privé avec la clé (à garder secret)</mj-text>
        <mj-text css-class="pill" padding="10px 14px" font-size="13px" color="${C.muted}"><a href="${esc(privateLink)}" style="word-break:break-all">${esc(privateLink)}</a></mj-text>
        <mj-text color="${C.fg}" padding="14px 0 0">Avec cette page tu peux :</mj-text>
        <mj-text color="${C.fg}" padding="0">
          🔒 <strong>Chat E2E</strong> — messagerie chiffrée de bout en bout avec tes contacts<br/>
          🗓 <strong>RDV</strong> — gère tes disponibilités et demandes<br/>
          🪪 <strong>Page publique</strong> — ta carte d'identité en ligne
        </mj-text>`,
      ctaLabel: "Accéder à mon espace →",
      ctaUrl: privateLink,
      note: "Le lien privé est ta seule clé d'accès en écriture. Garde-le précieusement.",
    }),
  };
}

/** Email au propriétaire : nouvelle demande de RDV reçue. */
export async function bookingRequestEmail(
  toHandle: string,
  req: { name: string; email?: string; message?: string; day?: string | null }
): Promise<Email> {
  const name = esc(req.name);
  const dayFr = req.day
    ? new Date(req.day + "T00:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    : null;
  const site = appUrl();
  const lines = [
    dayFr ? `Date souhaitée : ${dayFr}` : null,
    req.email ? `Email : ${req.email}` : null,
    req.message ? `Message : ${req.message}` : null,
  ].filter(Boolean) as string[];
  return {
    subject: `🦎 Nouvelle demande de RDV de ${req.name}`,
    text:
      `Coucou, c'est Milo 🦎 !\n\n` +
      `Tu as reçu une nouvelle demande de RDV de ${req.name} sur mindlog · id.\n` +
      (lines.length ? lines.join("\n") + "\n" : "") +
      `\nOuvre ton espace pour l'accepter ou la refuser : ${site}\n\n` +
      `À bientôt 🦎`,
    html: await layout({
      preview: `Nouvelle demande de RDV de ${req.name}`,
      heading: "Nouvelle demande de RDV 🗓",
      intro: `Coucou, c'est <strong style="color:${C.accent}">Milo</strong> 🦎 ! <strong>@${esc(toHandle)}</strong>, tu as reçu une demande de RDV de <strong>${name}</strong>.`,
      bodyHtml: lines.length
        ? `<mj-text css-class="pill" padding="10px 14px" font-size="13px" color="${C.muted}">${lines.map(esc).join("<br/>")}</mj-text>`
        : "",
      ctaLabel: "Voir la demande",
      ctaUrl: site,
      note: "Retrouve toutes tes demandes dans l'onglet RDV de ton agenda.",
    }),
  };
}

/**
 * Email de demande de RDV acceptée. Si le destinataire vient d'obtenir un compte
 * (auto-inscription), on lui transmet son lien magique pour activer une passkey.
 */
export async function bookingAcceptedEmail(
  byHandle: string,
  opts: { day?: string | null; isNew: boolean; magicLink?: string }
): Promise<Email> {
  const h = esc(byHandle);
  const profileUrl = `${appUrl()}/@${byHandle}`;
  const dayFr = opts.day
    ? new Date(opts.day + "T00:00:00Z").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    : null;
  const ctaUrl = opts.isNew && opts.magicLink ? opts.magicLink : profileUrl;
  const ctaLabel = opts.isNew ? "Activer mon compte →" : "Ouvrir le chat";
  const newAccountText = opts.isNew && opts.magicLink
    ? `\nUn compte mindlog · id vient d'être créé pour toi : vous êtes désormais contacts.\n` +
      `Ton lien privé (garde-le précieusement, il sert à créer ta passkey) :\n${opts.magicLink}\n`
    : `\nVous êtes désormais contacts : vous pouvez discuter en chat chiffré de bout en bout.\n`;
  const newAccountHtml = opts.isNew && opts.magicLink
    ? `<mj-text color="${C.fg}" padding="14px 0 0">Un compte vient d'être créé pour toi — vous êtes désormais contacts 🤝</mj-text>
       <mj-text css-class="pill" padding="10px 14px" font-size="13px" color="${C.muted}"><a href="${esc(opts.magicLink)}" style="word-break:break-all">${esc(opts.magicLink)}</a></mj-text>`
    : `<mj-text color="${C.fg}" padding="14px 0 0">Vous êtes désormais contacts — discutez en chat chiffré de bout en bout 🔒</mj-text>`;
  return {
    subject: `🦎 @${byHandle} a accepté ta demande de RDV`,
    text:
      `Coucou, c'est Milo 🦎 !\n\n` +
      `@${byHandle} a accepté ta demande de RDV sur mindlog · id.\n` +
      (dayFr ? `Date : ${dayFr}\n` : "") +
      newAccountText +
      `\nOuvre le chat : ${profileUrl}\n\n` +
      `À bientôt 🦎`,
    html: await layout({
      preview: `@${byHandle} a accepté ta demande de RDV`,
      heading: "Demande de RDV acceptée 🗓✅",
      intro: `Coucou, c'est <strong style="color:${C.accent}">Milo</strong> 🦎 ! <strong>@${h}</strong> a accepté ta demande de RDV${dayFr ? ` pour le <strong>${esc(dayFr)}</strong>` : ""}.`,
      bodyHtml: newAccountHtml,
      ctaLabel,
      ctaUrl,
      note: opts.isNew
        ? "Ce lien est ta seule clé d'accès en écriture. Garde-le précieusement et crée une passkey."
        : "Retrouvez votre conversation chiffrée dans l'onglet chat de son profil.",
    }),
  };
}

/**
 * Rappel au destinataire : une demande de RDV en attente approche de sa date.
 * `whenLabel` décrit l'échéance (« dans 1 mois », « demain »…).
 */
export async function bookingReminderEmail(
  toHandle: string,
  req: { name: string; day: string; message?: string },
  whenLabel: string
): Promise<Email> {
  const name = esc(req.name);
  const site = appUrl();
  const dayFr = new Date(req.day + "T00:00:00Z").toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
  return {
    subject: `🦎 Rappel : demande de RDV de ${req.name} (${whenLabel})`,
    text:
      `Coucou, c'est Milo 🦎 !\n\n` +
      `Petit rappel : la demande de RDV de ${req.name} pour le ${dayFr} (${whenLabel}) est toujours en attente.\n` +
      (req.message ? `Message : ${req.message}\n` : "") +
      `\nOuvre ton espace pour l'accepter ou la refuser : ${site}\n\n` +
      `À bientôt 🦎`,
    html: await layout({
      preview: `Rappel : demande de RDV de ${req.name} ${whenLabel}`,
      heading: "Rappel de demande de RDV ⏰",
      intro: `Coucou, c'est <strong style="color:${C.accent}">Milo</strong> 🦎 ! <strong>@${esc(toHandle)}</strong>, la demande de RDV de <strong>${name}</strong> pour le <strong>${esc(dayFr)}</strong> (${esc(whenLabel)}) est toujours <strong>en attente</strong>.`,
      bodyHtml: req.message
        ? `<mj-text css-class="pill" padding="10px 14px" font-size="13px" color="${C.muted}">${esc(req.message)}</mj-text>`
        : "",
      ctaLabel: "Répondre à la demande",
      ctaUrl: site,
      note: "Accepte pour devenir contacts, ou refuse : tu ne recevras plus de rappel pour cette demande.",
    }),
  };
}

/** Email de nouvelle relation : quelqu'un vous a ajouté. */
export async function relationEmail(fromHandle: string): Promise<Email> {
  const h = esc(fromHandle);
  const profileUrl = `${appUrl()}/@${fromHandle}`;
  return {
    subject: `🦎 @${fromHandle} t'a ajouté à ses relations`,
    text:
      `Coucou, c'est Milo 🦎 !\n\n` +
      `@${fromHandle} vient de t'ajouter à ses relations sur mindlog · id.\n` +
      `Voir son profil : ${profileUrl}\n\n` +
      `Ajoute-le en retour pour activer la messagerie chiffrée entre vous.\n\n` +
      `À bientôt 🦎`,
    html: await layout({
      preview: `@${fromHandle} t'a ajouté à ses relations`,
      heading: "Nouvelle relation 🤝",
      intro: `Coucou, c'est <strong style="color:${C.accent}">Milo</strong> 🦎 ! <strong>@${h}</strong> vient de t'ajouter à ses relations sur mindlog · id.`,
      bodyHtml: "",
      ctaLabel: "Voir son profil",
      ctaUrl: profileUrl,
      note: "Ajoute-le en retour pour activer la messagerie chiffrée de bout en bout entre vous 🔒.",
    }),
  };
}
