import QRCode from "qrcode";
import { writeFileSync, mkdirSync } from "node:fs";

// The table card's QR code for https://nbcc.scot/bag. High error correction, so a crease, a wine
// splash or a logo over the middle still scans. Run from the repo root: node tools/ball-bags/qr.mjs
// Writes tools/ball-bags/out/ (git ignored).
const url = "https://nbcc.scot/bag";
const opts = { errorCorrectionLevel: "H", margin: 2, color: { dark: "#2C2C2A", light: "#FFFFFF" } };
mkdirSync("tools/ball-bags/out", { recursive: true });
writeFileSync("tools/ball-bags/out/bag-qr.svg", await QRCode.toString(url, { ...opts, type: "svg" }));
await QRCode.toFile("tools/ball-bags/out/bag-qr.png", url, { ...opts, width: 1200 });
console.log("made", url);
