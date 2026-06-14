import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  // Fichiers/dossiers ignorés globalement
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "**/build/**", // couvre build/ racine ET android/**/build (rapports de tests générés)
      "data/**",
      "drizzle/**",
      "public/vendor/**", // bibliothèques tierces bundlées (sqlite3 wasm…) — non lintées
      "**/*.min.js",
      "src/mjml.d.ts",
    ],
  },

  // Base JS recommandée pour tout le monde
  js.configs.recommended,

  // ---- Code TypeScript (backend Node : src/, scripts/, test/, config racine) ----
  // Jeu de règles le plus complet : strict + stylistic, tous les deux
  // « type-checked » (analyse via le type-checker TypeScript).
  {
    files: ["src/**/*.ts", "scripts/**/*.ts", "test/**/*.ts", "*.ts"],
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        // tsconfig dédié au lint (inclut src + scripts + test + config racine)
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Interpoler un nombre dans un template literal est légitime et lisible.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],

      // Dette pré-existante du preset `strictTypeChecked` (règles d'opinion /
      // stylistiques) sur du code déjà en production : rétrogradées en `warn`
      // pour ne pas bloquer la CI. Toujours visibles, à résorber au fil de l'eau.
      // Les règles qui signalent de vrais bugs (no-undef, no-cond-assign, etc.)
      // restent en `error`.
      "@typescript-eslint/prefer-nullish-coalescing": "warn",
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/no-unnecessary-type-conversion": "warn",
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/no-base-to-string": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-redundant-type-constituents": "warn",
      "@typescript-eslint/no-empty-function": "warn",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "warn",
      // Fuites de `any` venant des SDK tiers (Stripe, Google/Dropbox/OneDrive…) :
      // un typage exhaustif viendra plus tard.
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      // Variables/imports inutilisés : warning (cohérent avec public/ et les .mjs).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      // Règles JS de base bruyantes sur ce code : warning.
      "no-useless-assignment": "warn",
      "no-useless-escape": "warn",
    },
  },

  // ---- Tests (node:test) : règles assouplies, propres au code de test ----
  {
    files: ["test/**/*.ts"],
    rules: {
      // Le runner gère les promesses retournées par test().
      "@typescript-eslint/no-floating-promises": "off",
      // Les assertions `!` et `any` sont monnaie courante et acceptables en test.
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },

  // ---- Code navigateur (public/) : JS ESM, environnement DOM ----
  {
    files: ["public/**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // Le front utilise des globals injectées par le serveur (window.__X__)
      // et des libs chargées via <script> ; on reste sur les règles JS de base.
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Les blocs catch vides sont une pratique assumée côté client (best-effort).
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Init défensif `let x = null; try { x = … } catch { return }` : toléré.
      "no-useless-assignment": "warn",
    },
  },

  // ---- Scripts Node ESM (.mjs) : runners e2e, scripts, validations ----
  // Tournent sous Node ; les fonctions passées à `page.evaluate` (e2e Playwright)
  // s'exécutent dans le navigateur → on autorise aussi les globals DOM.
  {
    files: ["e2e/**/*.mjs", "scripts/**/*.mjs", "test/**/*.mjs", "*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
