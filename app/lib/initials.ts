/**
 * Initials for the last-resort logo fallback (docs/API.md D, RISKS.md 4.3).
 *
 * Up to two characters: the first letter or digit of each of the first two
 * words of a repository name, splitting on spaces, `-`, `_`, `.` and `/`
 * (`fluent-bit` -> `FB`, `nginx` -> `N`). Uppercased. `?` when the name has
 * no letter or digit at all.
 */
export function initials(name: string): string {
  const letters = name
    .split(/[\s/._-]+/)
    .map((word) => /[\p{L}\p{N}]/u.exec(word)?.[0])
    .filter((letter): letter is string => letter !== undefined)
    .slice(0, 2);
  return letters.length > 0 ? letters.join('').toLocaleUpperCase('en-US') : '?';
}
