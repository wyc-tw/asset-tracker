import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 網址格式是 你的帳號.github.io/asset-tracker，多一層路徑，
  // 所以要告訴 Vite 打包時所有資源路徑都要加上這個前綴，不然畫面會空白。
  // 如果之後改用 Vercel/Netlify 等自訂網域，要把這行改回 base: '/'
  base: '/asset-tracker/',
  build: {
    rollupOptions: {
      output: {
        // 把 react / recharts 拆成獨立檔案。
        // 這兩個套件幾乎不會變動，拆開後瀏覽器可以把它們快取起來，
        // 之後只改 App.jsx 重新部署時，使用者只需要重新下載變動的那一小塊，
        // 不用每次都重新下載整包（包含這些函式庫）。
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'charts-vendor': ['recharts'],
        },
      },
    },
  },
})