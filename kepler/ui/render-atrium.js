// Предпросмотр в системе координат плана, в том числе при повороте вида.
export function drawAtriumPreview(ctx, draft, p2s, tokens) {
  let polygon = draft.preview?.polygon;
  const a = draft.anchor;
  const b = draft.cursor;
  if (a && b && !draft.rect) polygon = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  ctx.save();
  const trace = (ring) => {
    ctx.beginPath();
    ring.forEach((p, i) => {
      const q = p2s(p.x, p.y);
      if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y);
    });
    ctx.closePath();
  };
  if (draft.area === 'rect' && draft.roomOutline?.length) {
    trace(draft.roomOutline);
    ctx.fillStyle = tokens.accent;
    ctx.globalAlpha = .07;
    ctx.fill();
    ctx.globalAlpha = .8;
    ctx.strokeStyle = tokens.accent;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (polygon?.length) {
    const color = draft.preview && !draft.preview.ok ? tokens.danger : tokens.accent;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    trace(polygon);
    ctx.globalAlpha = .16;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (draft.railing && draft.preview?.ok) {
    ctx.strokeStyle = tokens.accent2;
    ctx.lineWidth = 4;
    for (const rail of draft.preview.rails) {
      const start = p2s(rail.a.x, rail.a.y);
      const end = p2s(rail.b.x, rail.b.y);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
  }
  if (draft.windowRect) {
    const { x, y, w, h } = draft.windowRect;
    trace([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]);
    ctx.strokeStyle = tokens.accent;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  if (b && !draft.rect) {
    const q = p2s(b.x, b.y);
    ctx.fillStyle = tokens.accent;
    ctx.fillRect(q.x - 4, q.y - 4, 8, 8);
  }
  ctx.restore();
}
