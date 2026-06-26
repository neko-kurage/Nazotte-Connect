import { defineConfig } from 'astro/config';

const repositoryBase = '/Nazotte-Connect';
const versionPath = process.env.NAZOTTE_CONNECT_VERSION_PATH?.replace(/^\/+|\/+$/g, '');
const base = versionPath ? `${repositoryBase}/${versionPath}` : repositoryBase;

export default defineConfig({
  site: 'https://neko-kurage.github.io',
  base,
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
