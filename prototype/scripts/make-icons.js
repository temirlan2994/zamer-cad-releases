// Sync the approved logo assets without redrawing or resizing the artwork.
// Run: npm run icons (from prototype/).
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const assets = [
  ["svg/zamer-cad-logo.svg", "prototype/icons/logo.svg"],
  ["svg/zamer-cad-logo-dark.svg", "prototype/icons/logo-dark.svg"],
  ["svg/zamer-cad-icon-small.svg", "prototype/icons/favicon.svg"],
  ["png/favicon-32.png", "prototype/icons/favicon-32.png"],
  ["png/icon-192.png", "prototype/icons/icon-192.png"],
  ["png/apple-touch-icon-180.png", "prototype/icons/icon-180.png"],
  ["png/play-store-icon-512.png", "prototype/icons/icon-512.png"],
  ["png/play-store-icon-512.png", "android-offline/app/src/main/res/drawable/app_icon.png"],
  ...["background", "foreground", "monochrome"].map(layer => [
    `png/android/ic_launcher_${layer}.png`,
    `android-offline/app/src/main/res/mipmap-xxxhdpi/ic_launcher_${layer}.png`,
  ]),
];

for (const [source, target] of assets) {
  const destination = path.join(root, target);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, "brand", source), destination);
  console.log(`Synced ${target}`);
}
