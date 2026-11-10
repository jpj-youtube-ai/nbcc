import { randomBytes, randomInt } from "node:crypto";
import { secretWord } from "./names";
import { isUsableSecretWord } from "./claim";

// NBCC Elf Detective School: the codes a door's poster and tag are made with.

/** 32 characters with nothing that looks like another (no l, o, 0 or 1). 256 divides by 32, so a
 *  byte taken modulo 32 is not biased towards any character. */
export const POSTER_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

const POSTER_CODE_LENGTH = 12;

/** The code from twelve bytes. Fewer than twelve is a mistake worth stopping for. */
export function posterCode(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.length < POSTER_CODE_LENGTH) {
    throw new Error(`A poster code needs ${POSTER_CODE_LENGTH} bytes`);
  }
  let code = "";
  for (let i = 0; i < POSTER_CODE_LENGTH; i++) code += POSTER_ALPHABET[bytes[i] % 32];
  return code;
}

/** A new poster code. The address it makes cannot be guessed. */
export function makePosterCode(): string {
  return posterCode(randomBytes(POSTER_CODE_LENGTH));
}

/** A new tag word such as "SNOWBALL 472". */
export function makeTagWord(): string {
  for (let attempt = 0; attempt < 5; attempt++) {
    const word = secretWord(() => randomInt(0, 1_000_000) / 1_000_000);
    if (word !== null && isUsableSecretWord(word)) return word;
  }
  throw new Error("Could not make a tag word");
}
