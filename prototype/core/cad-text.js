export function decodeCadText(value, multiline = false) {
  let text = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (multiline && (char === "{" || char === "}")) continue;
    if (char !== "\\") { text += char; continue; }
    const unicode = /^\\U\+([0-9a-f]{4})/i.exec(value.slice(index));
    if (unicode) {
      text += String.fromCharCode(Number.parseInt(unicode[1], 16));
      index += unicode[0].length - 1;
      continue;
    }
    if (!multiline) { text += char; continue; }
    const next = value[index + 1];
    if (["\\", "{", "}"].includes(next)) { text += next; index += 1; }
    else if (next === "P" || next === "N") { text += "\n"; index += 1; }
    else if (next === "~") { text += "\u00a0"; index += 1; }
    else if (/[LlOoKk]/.test(next || "")) index += 1;
    else if (/[ACFHQTWp]/i.test(next || "")) {
      const end = value.indexOf(";", index + 2);
      if (end < 0) text += char;
      else index = end;
    } else if (next === "S") {
      const end = value.indexOf(";", index + 2);
      if (end < 0) text += char;
      else { text += value.slice(index + 2, end).replace(/[\^#]/g, "/"); index = end; }
    } else text += char;
  }
  return text.replace(/%%([dpc])/gi, (_, glyph) => ({ d: "°", p: "±", c: "⌀" })[glyph.toLowerCase()]);
}

export function encodeMText(value) {
  return String(value).replace(/\r\n|\r/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\n/g, "\\P");
}
