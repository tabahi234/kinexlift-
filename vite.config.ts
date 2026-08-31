import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import {
  APP_NAME,
  APP_SHORT_NAME,
  APP_DESCRIPTION,
  THEME_COLOR,
  BACKGROUND_COLOR,
} from './src/config';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/favicon.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: APP_NAME,
        short_name: APP_SHORT_NAME,
        description: APP_DESCRIPTION,
        theme_color: THEME_COLOR,
        background_color: BACKGROUND_COLOR,
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Fonts are bundled, not fetched from a CDN, so they precache with
        // everything else and the app starts with no network at all.
        globPatterns: ['**/*.{js,css,html,woff,woff2,png,svg,ico}'],
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
      },
    }),
  ],
});
