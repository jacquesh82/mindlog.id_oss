import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  // Fichiers/dossiers ignorés globalement
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      "data/**",
      "drizzle/**",
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
    },
  },
);
