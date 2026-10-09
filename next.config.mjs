import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('./package.json');

// Short commit for Settings → About and /api/health. Docker builds pass GIT_SHA (there is no
// .git in the build context); a local build asks git; anything else shows no commit.
function buildCommit() {
  if (process.env.GIT_SHA) return process.env.GIT_SHA.trim().slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Inlined at build time, so client components can show the version without a request.
  env: { NEXT_PUBLIC_APP_VERSION: pkg.version, NEXT_PUBLIC_APP_COMMIT: buildCommit() },
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
