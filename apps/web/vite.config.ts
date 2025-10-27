import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Tipjar',
        short_name: 'Tipjar',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icons/icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/sbuxrender\.cognitiveservices\.azure\.com\//,
            handler: 'NetworkOnly'
          }
        ],
        globPatterns: ['**/*.{js,css,html,ico,png,svg}']
      }
    })
  ],
<<<<<<< ours
=======
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true
      }
    }
  },
>>>>>>> theirs
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
