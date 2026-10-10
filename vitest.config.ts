import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so the tests run in plain Node without the Electron plugins.
export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'electron/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
})
