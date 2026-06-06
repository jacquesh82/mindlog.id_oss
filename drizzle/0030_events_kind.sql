-- Type d'événement : 'event' (par défaut) | 'live'.
-- Un événement de type 'live' planifie une diffusion en direct dans l'espace
-- premium du créateur. La visibilité publique reste pilotée par is_public ; un
-- live coché 'public' apparaît dans l'agenda public + débloque le bouton Live.
ALTER TABLE "events" ADD COLUMN "kind" text DEFAULT 'event' NOT NULL;
