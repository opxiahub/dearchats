import type { NextConfig } from "next";

const config: NextConfig = {
  // "standalone" produces .next/standalone/ with a minimal server.js and
  // exactly the node_modules it needs. The Docker image ships only that
  // directory, the public/ folder, and .next/static/ — no devDeps, no source.
  output: "standalone",
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
  // better-sqlite3 is a native module — keep it external so Next doesn't try to bundle it.
  serverExternalPackages: ["better-sqlite3", "@napi-rs/canvas"],
};

export default config;
