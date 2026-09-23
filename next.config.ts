/**
 * Configurazione Next.js per sviluppo, compilazione e test browser.
 * Le variabili QUIZZONE_* separano cache e tipi generati dai test rispetto
 * al server usato manualmente; normalmente si usano .next e tsconfig.json.
 */
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: { tsconfigPath: process.env.QUIZZONE_TSCONFIG_PATH || "tsconfig.json" },
  distDir: process.env.QUIZZONE_DIST_DIR || ".next",
  // Next.js richiede solo l’hostname, mentre Socket.IO usa l’origine completa con porta.
  allowedDevOrigins: process.env.NEXT_PUBLIC_APP_URL ? [new URL(process.env.NEXT_PUBLIC_APP_URL).hostname] : [],
};

export default nextConfig;
