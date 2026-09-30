/* eslint-disable camelcase */

// TASK-472: EmpowHer's leaflet comes off the card, and its file leaves the site.
//
// TASK-456 put the organiser's leaflet on EmpowHer's card. Jaimie thought it looked wrong live and
// took the picture off in the admin on 2026-09-30, keeping the corrected words. So production has no
// picture, and the file (assets/img/empowher-2026-leaflet.webp) is deleted in this change.
//
// 1789100000003 is merged and never edited, and on a fresh database (CI, a restore) it still puts
// that picture on. This takes it off again wherever it is still exactly the leaflet, so every
// database ends where production is, and no card points at a file that is gone. Compare and swap,
// as before: a picture staff chose stays, the words stay, and updated_by is left alone.
//
// On production this matches nothing and changes nothing.

const SLUG = "empowher-2026";
const LEAFLET_SRC = "/assets/img/empowher-2026-leaflet.webp";

// The picture settings the leaflet brought, and the event's own before it.
const PICTURE_OFF = [
  { field: "imageSrc", column: "image_src", from: LEAFLET_SRC, to: null },
  { field: "imageFit", column: "image_fit", from: "whole", to: "cover" },
  { field: "imageGround", column: "image_ground", from: "cream", to: "night" },
];

function literal(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

exports.LEAFLET_OFF = { slug: SLUG, src: LEAFLET_SRC, picture: PICTURE_OFF };

exports.up = (pgm) => {
  pgm.sql(`
    UPDATE events SET
      ${PICTURE_OFF.map((p) => `${p.column} = ${literal(p.to)}`).join(",\n      ")},
      updated_at = now()
     WHERE slug = ${literal(SLUG)} AND image_src = ${literal(LEAFLET_SRC)}
  `);
};

// Nothing to put back: the file is gone, and a card must never point at a picture that is not there.
exports.down = () => {};
