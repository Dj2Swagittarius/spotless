/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3', 'music-metadata'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // microphone: the AI DJ's push-to-talk (recorded audio goes to the configured speech server)
          // stop MIME sniffing — matters for the artwork route that serves attacker-influenced SVG
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(self), camera=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
