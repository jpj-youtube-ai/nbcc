import sharp from "sharp";

let kept: Buffer | undefined;

/** A real 4 by 4 red JPEG, made with sharp the first time it is asked for and kept after that. */
export async function tinyJpeg(): Promise<Buffer> {
  if (!kept) {
    kept = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .jpeg()
      .toBuffer();
  }
  return kept;
}
