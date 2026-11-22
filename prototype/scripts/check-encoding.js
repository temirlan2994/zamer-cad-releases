const fs = require("node:fs");
const path = require("node:path");

const files = ["index.html", "app.js", "styles.css", "sw.js"];

const mojibakePatterns = [
  /[\u0080-\u009f]/g,
  /Р[\u0400-\u040f\u0450-\u045f\u0490\u0491\u00a0-\u00bb\u2018-\u201d\u2020-\u2026\u2030\u2039\u203a]/g,
  /С[\u0400-\u040f\u0450-\u045f\u0490\u0491\u00a0-\u00bb\u2018-\u201d\u2020-\u2026\u2030\u2039\u203a]/g,
  /в[\u2020\u2013\u2014\u2022\u20ac\u00a7\u2021\u02dc\u201c\u201d]/g,
  /Г[\u2014\u00b0]/g,
  /В[\u00b0\u00b7]/g,
  /рџ/g,
  /\uFFFD/g,
  /\?{3,}/g,
];

let failed = false;

for (const file of files) {
  const text = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const hits = [];
  for (const pattern of mojibakePatterns) {
    for (const match of text.matchAll(pattern)) {
      const start = Math.max(0, match.index - 32);
      const end = Math.min(text.length, match.index + 64);
      hits.push({
        index: match.index,
        value: match[0],
        context: text.slice(start, end).replace(/\s+/g, " "),
      });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  if (hits.length) {
    failed = true;
    console.error(`Encoding check failed in ${file}`);
    for (const hit of hits.slice(0, 20)) {
      console.error(`  ${hit.index}: ${JSON.stringify(hit.value)} in ${JSON.stringify(hit.context)}`);
    }
    if (hits.length > 20) console.error(`  ...and ${hits.length - 20} more`);
  }
}

if (failed) process.exit(1);
console.log("Encoding check passed");
