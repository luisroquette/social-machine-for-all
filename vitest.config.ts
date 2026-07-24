import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    // .worktrees/ contém checkouts paralelos (branches em andamento) usados pela
    // skill using-git-worktrees. Sem essa exclusão, `vitest run` varre recursivamente
    // e o pre-push hook bloqueia pushes da árvore principal por causa de testes
    // falhando em um branch não relacionado dentro do worktree.
    exclude: ['**/node_modules/**', '**/.worktrees/**'],
  },
})
