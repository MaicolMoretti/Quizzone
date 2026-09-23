import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: { tsconfigPath: process.env.QUIZZONE_TSCONFIG_PATH || "tsconfig.json" },
  distDir: process.env.QUIZZONE_DIST_DIR || ".next",
  allowedDevOrigins: process.env.NEXT_PUBLIC_APP_URL ? [new URL(process.env.NEXT_PUBLIC_APP_URL).hostname] : [],
};

export default nextConfig;
