import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true,
    watch: {
      ignored: ['**/dist/**', '**/.git/**', '**/scratch/**', '**/*.log']
    }
  },
  build: {
    target: 'esnext'
  }
});
