import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts: the React Router plugin builds the app and isn't
// meant to run under Vitest. Projects inherit the plugins below (`extends: true`).
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['app/**/*.test.ts', 'test/**/*.test.ts'],
          setupFiles: ['test/setup.node.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['app/**/*.test.tsx'],
          setupFiles: ['test/setup.dom.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // Target ~80% on server and lib code (questionnaire F33). Report only: no
      // threshold fails the run. The default watermarks (50/80) color the report.
      include: ['app/server/**/*.ts', 'app/lib/**/*.ts'],
      exclude: ['**/*.test.ts', 'app/lib/params.cases.ts'],
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
});
