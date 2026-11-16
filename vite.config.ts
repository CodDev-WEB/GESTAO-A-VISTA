import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Alvo amplo: TVs, TV boxes e celulares com navegador antigo (Chromium 61+; Safari 12+ executa ES2017).
// O padrão do Vite (Chrome 87+/Safari 14+) deixava esses aparelhos com a tela branca.
export default defineConfig({
  plugins: [react()],
  build: { target: ['es2017', 'chrome61', 'firefox60', 'edge79'], cssTarget: ['chrome61', 'safari12'] },
})
