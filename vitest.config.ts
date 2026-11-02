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
          setupFiles: ['test/setup.msw.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['app/**/*.test.tsx', 'test/**/*.test.tsx'],
          // MSW guards the dom project too: jsdom keeps Node's `fetch`, so without it
          // a component test could reach the real Docker Hub.
          setupFiles: ['test/setup.msw.ts', 'test/setup.dom.ts'],
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
