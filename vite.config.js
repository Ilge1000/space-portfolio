import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // не подхватывать postcss.config.js из родительской папки
  css: { postcss: {} },
})
