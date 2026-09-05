import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '#shared': fileURLToPath(new URL('./shared/', import.meta.url)),
    },
  },
})
