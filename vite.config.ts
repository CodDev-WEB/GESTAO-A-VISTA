import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

// Dois pacotes:
// - moderno (ES2020) para navegadores atuais;
// - legado (ES5 + polyfills) carregado automaticamente por navegadores antigos,
//   como os das smart TVs Multilaser com sistema Linux, TV boxes e celulares antigos.
export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['chrome >= 38', 'android >= 4.4', 'safari >= 9', 'ios >= 9', 'firefox >= 52', 'opera >= 25', 'samsung >= 4'],
      modernPolyfills: true,
      additionalLegacyPolyfills: ['whatwg-fetch', 'abortcontroller-polyfill/dist/abortcontroller-polyfill-only'],
    }),
  ],
  build: { cssTarget: ['chrome38', 'safari9'] },
})
