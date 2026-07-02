const isGithubPages = process.env.GITHUB_PAGES === "true";
const repoBasePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  basePath: isGithubPages && repoBasePath ? repoBasePath : "",
  assetPrefix: isGithubPages && repoBasePath ? `${repoBasePath}/` : "",
  eslint: {
    ignoreDuringBuilds: true
  }
};

export default nextConfig;
