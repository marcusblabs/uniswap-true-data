import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served from https://<user>.github.io/uniswap-true-data/
const REPO_BASE = '/uniswap-true-data/'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? REPO_BASE : '/',
  server: { port: 3000 },
}))
