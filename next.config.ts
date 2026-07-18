import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "prisma",
    "pg",
    "@neondatabase/serverless",
    "xlsx",
    "sharp",
  ],
}

export default nextConfig
