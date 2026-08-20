import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pg reads certificates from disk at runtime; bundling it under webpack in `next dev`
  // breaks on the fs require, so it must stay an external server package.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
