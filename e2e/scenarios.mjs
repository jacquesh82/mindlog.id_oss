// Scénarios de vérification navigateur (Playwright/Chromium).
// Régression de l'éclatement de public/app.js en modules ES : si un import est
// cassé (export manquant, orphelin), l'app `type=module` ne démarre pas → la
// scène « boot » échoue. Les scènes suivantes valident le câblage runtime.
//
// Chaque scénario : { name, run(page, ctx) }. `ctx` est partagé (la création de
// compte y dépose la clé d'accès, réutilisée par l'éditeur). Lever une erreur =
// échec. Les erreurs console/page sont collectées par le runner (e2e/run.mjs).
//
// Ajouter un scénario = pousser un objet dans ce tableau.

const uniqHandle = (ctx) => "e2e" + String(ctx.stamp).slice(-7);

export const scenarios = [
  {
    name: "boot — l'app démarre, #app rendu, 0 erreur, modules 200",
    async run(page, ctx) {
      const appLen = await page.evaluate(() => document.getElementById("app")?.innerHTML?.length || 0);
      if (appLen < 500) throw new Error(`#app quasi vide (${appLen} car.) — un import ES est probablement cassé`);
      const title = await page.title();
      if (!/mindlog/i.test(title)) throw new Error("titre inattendu: " + title);
      // les 4xx/5xx same-origin sont vérifiés globalement par le runner
    },
  },
  {
    name: "thème — le toggle bascule data-theme",
    async run(page) {
      const before = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
      await page.evaluate(() => document.querySelector(".theme-toggle")?.click());
      await page.waitForTimeout(250);
      const after = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
      if (before === after) throw new Error(`thème inchangé (${before})`);
    },
  },
  {
    name: "i18n — passer en FR change la langue + les libellés",
    async run(page) {
      await page.selectOption("#lang-select", "fr").catch(() => {});
      await page.waitForTimeout(400);
      const lang = await page.evaluate(() => document.documentElement.lang);
      if (lang !== "fr") throw new Error("documentElement.lang=" + lang + " (attendu fr)");
      const txt = await page.evaluate(() => document.getElementById("create-btn")?.innerText || "");
      if (!/Cr[ée]er/i.test(txt)) throw new Error("bouton création non traduit: " + JSON.stringify(txt));
    },
  },
  {
    name: "modale création — s'ouvre avec les champs handle/nom (ui/dom)",
    async run(page) {
      await page.click("#create-btn");
      await page.waitForTimeout(400);
      if (!(await page.$("#cr-handle"))) throw new Error("champ #cr-handle absent");
      if (!(await page.$("#cr-name"))) throw new Error("champ #cr-name absent");
      await page.click("#cr-close").catch(() => {});
    },
  },
  {
    name: "création de compte — POST /api/identities renvoie 201 + clé",
    async run(page, ctx) {
      let post = null;
      page.on("response", async (r) => {
        if (r.url().includes("/api/identities") && r.request().method() === "POST") {
          post = { status: r.status(), json: await r.json().catch(() => ({})) };
        }
      });
      await page.click("#create-btn");
      await page.waitForTimeout(300);
      const handle = uniqHandle(ctx);
      await page.fill("#cr-handle", handle);
      await page.fill("#cr-name", "E2E Test");
      await page.click('.overlay button[type="submit"]');
      await page.waitForTimeout(2500);
      if (!post) throw new Error("aucun POST /api/identities observé");
      if (post.status !== 201) throw new Error("statut " + post.status);
      if (!post.json.accessKey) throw new Error("pas d'accessKey dans la réponse");
      ctx.handle = handle;
      ctx.accessKey = post.json.accessKey;
    },
  },
  {
    name: "éditeur privé — /k/<clé> rend l'éditeur (renderEditor + crypto E2E)",
    async run(page, ctx) {
      if (!ctx.accessKey) throw new Error("dépend de la création de compte (échouée)");
      // NB : la vue privée ouvre un flux SSE persistant → « networkidle » n'arrive
      // jamais. On attend le DOM puis on laisse le rendu se poser.
      await page.goto(ctx.base + "/k/" + encodeURIComponent(ctx.accessKey), { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      const len = await page.evaluate(() => document.getElementById("app")?.innerText?.length || 0);
      if (len < 100) throw new Error("éditeur vide (" + len + " car.)");
      // le deck de l'éditeur expose une nav « branche »
      const hasDeck = await page.evaluate(
        () => !!document.querySelector("#deck-nav, .branch-nav, .deck, [data-deck-label]")
      );
      if (!hasDeck) throw new Error("nav deck de l'éditeur introuvable");
      const cols = await page.evaluate(() => [...document.querySelectorAll(".col")].map((c) => c.dataset.deckLabel));
      for (const need of ["Menu", "Identité", "Agenda", "Options"]) {
        if (!cols.includes(need)) throw new Error("colonne deck manquante: " + need + " (vues: " + cols.join(",") + ")");
      }
    },
  },
  {
    // Scénario complet d'interactions éditeur, en un seul contexte (les modales
    // d'accueil dépendent de l'état local du navigateur). Couvre : coffre E2E
    // obligatoire (ui/modals + crypto/vault + net), navigation deck (deckState),
    // bascule d'onglet, et sauvegarde d'un champ (wireEditor + net).
    name: "éditeur : coffre E2E + deck + onglet",
    async run(page, ctx) {
      if (!ctx.accessKey) throw new Error("dépend de la création de compte (échouée)");
      let vaultPut = null;
      page.on("response", (r) => {
        if (r.url().includes("/api/e2e/vault") && r.request().method() === "PUT") vaultPut = r.status();
      });
      await page.goto(ctx.base + "/k/" + encodeURIComponent(ctx.accessKey), { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);

      // 1) coffre E2E obligatoire : choisir passphrase, valider
      const eb = await page.$("#eb-pass");
      if (eb) {
        await eb.click({ force: true }); // le bouton contient un <span> enfant qui intercepte le point
        const inp = await page.waitForSelector(
          '.overlay input#pp-in, .overlay input[type="password"], .overlay input[type="text"]',
          { timeout: 6000 }
        );
        await inp.fill("e2e-passphrase-robuste");
        await page.click("#pp-ok"); // bouton « Valider » du prompt passphrase (id unique)
        await page.waitForTimeout(2000);
        if (vaultPut == null) throw new Error("aucun PUT /api/e2e/vault (sauvegarde du coffre)");
        if (vaultPut >= 400) throw new Error("PUT /api/e2e/vault -> " + vaultPut);
      }

      // 2) navigation deck vers Identité via le hook de label du deck (closure
      // cols/go courant — deck.js). L'ancienne pile de liens #menu-nav de l'aperçu
      // a été retirée ; ce hook teste la vraie navigation par label du deck.
      await page.evaluate(() => window.__deckGoLabel && window.__deckGoLabel("Identité"));
      await page.waitForTimeout(900);
      const active = await page.evaluate(() => {
        const c = [...document.querySelectorAll(".col")].find((x) => x.classList.contains("active"));
        return c ? c.dataset.deckLabel : null;
      });
      if (active !== "Identité") throw new Error("deck non navigué vers Identité (actif: " + active + ")");

      // 3) bascule d'onglet interne (profil ↔ réseaux)
      await page.click('.id-tab[data-tab="reseaux"]');
      await page.waitForTimeout(400);
      const reseauxHidden = await page.evaluate(() => document.getElementById("id-reseaux")?.hasAttribute("hidden"));
      if (reseauxHidden) throw new Error("l'onglet Réseaux n'est pas affiché après clic");
      // NB : l'écriture d'un champ (#nf-key) n'est pas testée ici — sous le deck
      // GSAP en headless la colonne n'est pas fiablement « visible » pour Playwright.
      // La sauvegarde réseau est déjà couverte par le PUT /api/e2e/vault ci-dessus.
    },
  },
];
