/**
 * Regole statiche per Next.js, TypeScript e motore Node. Gli artefatti
 * generati durante compilazione e test vengono esclusi, anche per evitare
 * letture concorrenti di file temporanei che Next.js ricrea.
 */
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Il motore Node separato usa intenzionalmente moduli CommonJS.
  {
    files: ["socket-server/**/*.js", "tests/browser/fixture-server.mjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Integra le esclusioni predefinite di eslint-config-next.
  globalIgnores([
    // Cache, risultati di test e dichiarazioni generate non sono sorgenti da controllare.
    ".next/**",
    ".next-e2e/**",
    "test-results/**",
    "playwright-report/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
