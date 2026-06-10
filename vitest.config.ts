import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    // Pin the suite to UTC so timezone-boundary tests are deterministic on any
    // host: a UTC-vs-client-local regression must fail everywhere, not only on
    // UTC-or-west machines (and several date fixtures parse as UTC midnight
    // but are read back through local getters).
    env: { TZ: 'UTC' },
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'vitest.config.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})
