import { closeWords } from "../tickets/model";

// Event tickets: when sales close, with its words, as the private area and the admin both show it.
// Never asked (null) is when the event starts.
export function closeOf(mode: string | null, at: string | null): { mode: string; at: string | null; words: string } {
  const m = mode ?? "start";
  return { mode: m, at: m === "custom" ? at : null, words: closeWords({ mode: m, at }) };
}
