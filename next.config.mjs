/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Optional: build into another folder (e.g. to check a build while the dev server is running).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    serverActions: { bodySizeLimit: '4mb' }, // job photos & expense receipts
  },
};
export default nextConfig;
