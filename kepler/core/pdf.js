// Минимальный PDF без библиотек: каждая страница — картинка JPEG на весь
// лист (растровый лист чертежа). Чистый модуль: байты на вход, байты на выход.
//
// pages: [{ jpeg: Uint8Array, widthPx, heightPx, widthMm, heightMm }]

const encoder = new TextEncoder();
const MM_TO_PT = 72 / 25.4;

// Строка PDF в UTF-16BE (hex): заголовок может быть на кириллице.
export function pdfTextString(text) {
  let hex = 'FEFF';
  for (const ch of String(text ?? '')) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0');
      hex += (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else {
      hex += cp.toString(16).padStart(4, '0');
    }
  }
  return `<${hex.toUpperCase()}>`;
}

export function buildImagePdf(pages, { title = '', producer = 'Kepler Plan' } = {}) {
  if (!pages.length) throw new Error('PDF: нет страниц');
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n, body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    if (Array.isArray(body)) body.forEach(push); else push(body);
    push('\nendobj\n');
  };

  // Номера объектов: 1 — каталог, 2 — дерево страниц, 3 — сведения,
  // далее на каждую страницу по три: страница, картинка, содержимое.
  const pageObj = (i) => 4 + i * 3;
  push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n'); // «двоичный» комментарий
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  object(3, `<< /Title ${pdfTextString(title)} /Producer ${pdfTextString(producer)} >>`);
  pages.forEach((p, i) => {
    const w = (p.widthMm * MM_TO_PT).toFixed(2);
    const h = (p.heightMm * MM_TO_PT).toFixed(2);
    const po = pageObj(i);
    object(po, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] `
      + `/Resources << /XObject << /Im${i} ${po + 1} 0 R >> >> /Contents ${po + 2} 0 R >>`);
    object(po + 1, [
      `<< /Type /XObject /Subtype /Image /Width ${p.widthPx} /Height ${p.heightPx} /ColorSpace /DeviceRGB `
        + `/BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      '\nendstream',
    ]);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
    object(po + 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  const size = 4 + pages.length * 3;
  const xref = length;
  let table = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n += 1) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}
