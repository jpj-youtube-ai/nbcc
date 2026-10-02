// TASK-504 review: a fundraiser's QR code depends only on the address it carries, and drawing the
// print size PNG takes real time on a small server. So each code is drawn once and kept in memory,
// keyed by that address, in a cache that never holds more than QR_CACHE_MAX codes: when full, the
// oldest goes first. (A Map keeps insertion order, so its first key is the oldest.)

export const QR_CACHE_MAX = 500;

export interface QrCache<T> {
  /** The code for `url`, drawn by `draw` only the first time it is asked for. */
  get(url: string, draw: (url: string) => T): T;
  size(): number;
}

export function createQrCache<T>(max: number = QR_CACHE_MAX): QrCache<T> {
  const kept = new Map<string, T>();
  return {
    get(url, draw) {
      const have = kept.get(url);
      if (have !== undefined) return have;
      const made = draw(url);
      if (kept.size >= max) {
        const oldest = kept.keys().next().value;
        if (oldest !== undefined) kept.delete(oldest);
      }
      kept.set(url, made);
      return made;
    },
    size: () => kept.size,
  };
}

/** The PNGs and the SVGs the public QR code routes serve (src/routes/fundraise-pages.ts). */
export const qrPngCache = createQrCache<Buffer>();
export const qrSvgCache = createQrCache<string>();
