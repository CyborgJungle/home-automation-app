import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Baked into the client so it can tell when a newer deploy is live (see lib/home.tsx).
  env: { NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
};

export default nextConfig;
