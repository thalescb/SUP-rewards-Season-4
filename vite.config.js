import { defineConfig } from 'vite';

export default defineConfig({
  // Use relative paths so the built site works when deployed to a GitHub Pages
  // sub-path (e.g. https://user.github.io/repo/) without any further config.
  base: './',

  build: {
    outDir: 'dist',

    // Do not minify — keep the output readable for auditing / debugging.
    minify: false,

    rollupOptions: {
      output: {
        // Deterministic, human-readable chunk names instead of hashed ones.
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
