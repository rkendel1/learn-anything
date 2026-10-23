import type { NextConfig } from "next";
const convexDeployment = process.env.CONVEX_DEPLOYMENT?.replace(/^[^:]+:/, "");
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? (convexDeployment ? `https://${convexDeployment}.convex.cloud` : undefined);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_CONVEX_URL: convexUrl,
  },
};
export default nextConfig;
