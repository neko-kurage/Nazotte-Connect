import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://neko-kurage.github.io',
  base: '/Nazotte-Connect',
  devToolbar: {
    enabled: false,
  },
  vite: {
    plugins: [
      {
        name: 'fix-rolldown-esbuild-compat',
        enforce: 'pre',
        configResolved(config) {
          if (config.optimizeDeps?.esbuildOptions?.plugins) {
            config.optimizeDeps.esbuildOptions.plugins = [];
          }
        },
      },
    ],
  },
});
