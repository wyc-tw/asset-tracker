import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 網址格式是 你的帳號.github.io/asset-tracker，多一層路徑，
  // 所以要告訴 Vite 打包時所有資源路徑都要加上這個前綴，不然畫面會空白。
  // 如果之後改用 Vercel/Netlify 等自訂網域，要把這行改回 base: '/'
  base: '/asset-tracker/',
})
