import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Pin the workspace root: there is a stray package-lock.json in a parent
  // directory that Turbopack would otherwise try to use.
  turbopack: { root: __dirname },
  // No page is meant to be shown inside another site's frame (clickjacking).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}

export default nextConfig
