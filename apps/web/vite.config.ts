import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // A household app should not nag four people to reload. It updates itself
      // on the next navigation; there is no release anyone is waiting on.
      registerType: 'autoUpdate',
      manifest: {
        name: 'Pantry',
        short_name: 'Pantry',
        description: "What's in the kitchen, and what's for dinner.",
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f7f4ef',
        theme_color: '#4f7a5b',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // Client-side routing: every navigation renders the app shell, except
        // anything under /api, which must always reach the server or fail.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // Deliberately generous. A limit tuned just above today's bundle is a
        // trap: the day the main chunk grows past it, it silently drops out of
        // the precache and the app stops working offline with no failure
        // anywhere. Paying ~125 KB gzipped once, on a home network, to keep
        // that impossible is the right trade. (That cost is the ZXing chunk,
        // which only Safari ever loads.)
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            // Reads are served from the network when there is one and from the
            // last good response when there is not. Workbox only handles GET,
            // so writes are never cached or replayed — see DECISIONS.md D-017.
            urlPattern: ({ url, request }) =>
              url.pathname.startsWith('/api/') && request.method === 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pantry-api',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
      devOptions: {
        // Off in dev: a service worker caching a dev server is a debugging trap.
        enabled: false,
      },
    }),
  ],
  server: {
    // Phones on the LAN hit the dev server directly, so bind all interfaces.
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
