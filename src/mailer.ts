import nodemailer from "nodemailer";

/**
 * Messagerie optionnelle, configurée via les variables d'environnement (.env).
 * Si le SMTP n'est pas configuré, l'app retombe sur un comportement dégradé
 * (la clé de récupération est renvoyée directement plutôt qu'envoyée par email).
 * Les variables sont lues paresseusement (à l'appel) pour ne pas dépendre de
 * l'ordre de chargement du .env.
 */

export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.MAIL_FROM);
}

let transporter: nodemailer.Transporter | null = null;
function getTransport(): nodemailer.Transporter {
  transporter ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  if (!isMailConfigured()) throw new Error("SMTP non configuré.");
  await getTransport().sendMail({ from: process.env.MAIL_FROM, ...opts });
}

export function appUrl(): string {
  if (!process.env.APP_URL) {
    console.warn("[mailer] APP_URL non défini — les liens email pointent vers localhost. Ajouter APP_URL=https://... dans .env");
  }
  return (process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 8787}`).replace(/\/$/, "");
}
