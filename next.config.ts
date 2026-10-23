import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a verification build run beside `npm run dev` without sharing (and
  // corrupting) its .next cache: NEXT_DIST_DIR=.next-verify npm run build
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
