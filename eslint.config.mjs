import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Interface en français : les apostrophes dans le texte JSX sont légitimes.
      "react/no-unescaped-entities": "off",
      // Après un changement de session (connexion, déconnexion, changement d'entreprise),
      // un rechargement complet est voulu pour repartir d'un état serveur propre.
      "@next/next/no-location-assign-relative-destination": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
