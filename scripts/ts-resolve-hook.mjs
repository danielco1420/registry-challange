// Resolves extensionless relative specifiers (`./params`) to their `.ts` file,
// so `scripts/check-params.ts` can import `app/lib` modules the same way the
// app's bundler does, without adding a test framework or build step.
const KNOWN_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|json)$/i;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !KNOWN_EXTENSIONS.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Fall through to default resolution (and its error) below.
    }
  }
  return nextResolve(specifier, context);
}
