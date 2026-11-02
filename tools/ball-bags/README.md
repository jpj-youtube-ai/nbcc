# Red bags at the Ball: the picture and the table cards

The sources for the bag picture on `/bag` and for the printed table cards. Nothing here is served or
built into the app: `tsconfig.json` only compiles `src/`, lint only reads `.ts` files, and the
Dockerfile copies none of `tools/`. Everything the scripts make goes to `tools/ball-bags/out/`
(git ignored), never straight over `assets/img`.

Run everything from the repo root, after `npm install`. Chrome is at
`C:\Program Files\Google\Chrome\Application\chrome.exe` on the machine these were made on.

## Re-bake the hero picture

`hero.html` holds the drawing (an SVG, 400 by 440, in Fill a Red Bag's style). To change it, edit
the SVG, then in PowerShell:

```powershell
$root = (Get-Location).Path
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
& $chrome --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 `
  --force-device-scale-factor=3 --window-size=400,440 `
  "--screenshot=$root\tools\ball-bags\out\shot.png" `
  "file:///$($root -replace '\\','/')/tools/ball-bags/hero.html"
node tools/ball-bags/bake.cjs
```

The first command is Chrome's 3x screenshot of the drawing on a transparent background (make the
`out` folder first if it is not there). `bake.cjs` crops it and writes `ball-bag-hero.webp` (560
wide) and `nbcc-logo-192.webp` into `tools/ball-bags/out/`, plus `hero-check.png` to look at on
cream. When you are happy, copy the two WebP files into `assets/img/` by hand and keep the hero
under about 30KB.

## Re-make the A6 and A4 table cards

The QR code points at `https://nbcc.scot/bag`, with error correction level H so a crease or a wine
splash still scans. Change the address only by editing `qr.mjs` on purpose.

```powershell
node tools/ball-bags/qr.mjs
node tools/ball-bags/card.mjs
$root = (Get-Location).Path
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$u = $root -replace '\\','/'
& $chrome --headless --disable-gpu --no-pdf-header-footer --virtual-time-budget=10000 `
  "--print-to-pdf=$root\tools\ball-bags\out\red-bag-table-card-A6.pdf" `
  "file:///$u/tools/ball-bags/out/card-a6.html"
& $chrome --headless --disable-gpu --no-pdf-header-footer --virtual-time-budget=10000 `
  "--print-to-pdf=$root\tools\ball-bags\out\red-bag-table-cards-A4-four.pdf" `
  "file:///$u/tools/ball-bags/out/card-a4-four.html"
```

`qr.mjs` writes `bag-qr.svg` and `bag-qr.png`; `card.mjs` reads the SVG and writes `card-a6.html`
(105 by 148mm) and `card-a4-four.html` (four to an A4 sheet, with faint cut lines). The pages load
Poppins, Playfair Display and Caveat from Google Fonts, so print with the machine online. Check the
PDFs by eye (the QR scans from a phone, the fonts are right) before they go to the printer.
