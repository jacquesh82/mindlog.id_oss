-- Intro du profil (Markdown, max 4000 chars) — déplacée de premium_space vers
-- identities pour devenir une feature OSS accessible à tous les comptes.
-- Affichée en haut de /@handle, au-dessus de la bio.
ALTER TABLE "identities" ADD COLUMN "profile_intro_md" text DEFAULT '' NOT NULL;
