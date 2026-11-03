// The night outside the Workshop, the parts both places draw it from: the stage on the home page and
// Get involved (./stage.ts), and /fill itself after the Ball's moment (./render.ts). Plain markup with
// no words in it; each place has its own styles for it.

/** A soft edge of snow. */
export const DRIFT =
  '<svg class="drift" viewBox="0 0 1440 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M0 62c90-34 170-44 262-20s150 44 252 26 176-58 292-44 168 54 276 50 170-40 358-34v60H0z"/></svg>';

/** A string of ten bulbs, one for every £5 of the first £50: they come on as the bag fills. */
export function renderLights(): string {
  const colours = ["#FF6B6B", "#F4C95D", "#FFF3D6", "#7FD67F"];
  const [x0, y0, cx, cy, x1, y1] = [0, -58, 330, 190, 660, -58];
  let bulbs = "";
  for (let i = 0; i < 10; i += 1) {
    const t = (i + 0.5) / 10;
    const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t ** 2 * x1;
    const y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t ** 2 * y1;
    const tilt = (t - 0.5) * -34 + (i % 2 ? 7 : -7);
    bulbs +=
      `<g class="bulb" style="--c:${colours[i % 4]};--i:${i}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${tilt.toFixed(1)})">` +
      '<circle class="halo" r="30" cy="17" fill="url(#fbHalo)"/>' +
      '<rect class="cap" x="-4.5" y="0" width="9" height="8" rx="1.5"/>' +
      '<path class="glass" d="M0 34c-7-5-10.5-11-10.5-16.5S-5.5 8 0 8s10.5 4 10.5 9.5S7 29 0 34z"/></g>';
  }
  return (
    '<svg class="fb-lights" viewBox="0 -58 660 188" aria-hidden="true" focusable="false"><defs>' +
    '<radialGradient id="fbHalo"><stop offset="0" stop-color="#FFE9A8" stop-opacity=".85"/><stop offset="1" stop-color="#FFE9A8" stop-opacity="0"/></radialGradient></defs>' +
    `<path class="wire" d="M${x0} ${y0}Q${cx} ${cy} ${x1} ${y1}"/>${bulbs}</svg>`
  );
}
