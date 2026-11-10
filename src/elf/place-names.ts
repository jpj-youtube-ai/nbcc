// NBCC Elf Detective School: a place name as a guess is matched against it. Capitals, accents,
// spacing, marks and a leading "the" make no difference.

export function normalisePlaceName(name: string): string {
  const plain = String(name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/^the(?![a-z0-9])/, "");
  return plain.replace(/[^a-z0-9]/g, "");
}

export function sameName(a: string, b: string): boolean {
  const left = normalisePlaceName(a);
  return left !== "" && left === normalisePlaceName(b);
}
