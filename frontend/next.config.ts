import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    console.log("Backend URL:", process.env.BACKEND_URL);
    return [
      {
        source: "/service/:path*",
        destination: process.env.BACKEND_URL || "http://backend:8000/:path*",
      },
    ];
  },
};

export default nextConfig;
