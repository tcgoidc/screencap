const { defineConfig } = require('vite')

module.exports = defineConfig({
  build: {
    rollupOptions: {
      input: {
        about: 'about.html',
        main: 'index.html',
        overlay: 'overlay.html',
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
})