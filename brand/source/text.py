# Shape text with HarfBuzz (kerning) and convert to SVG path data with fontTools.
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

_cache = {}
def _font(path):
    if path not in _cache:
        blob = hb.Blob.from_file_path(path)
        face = hb.Face(blob)
        hbfont = hb.Font(face)
        tt = TTFont(path)
        _cache[path] = (hbfont, tt, tt.getGlyphSet(), tt["head"].unitsPerEm)
    return _cache[path]

def text_path(text, font_path, size, x=0, y=0, tracking=0.0):
    """Return (svg_path_d, advance_width_px) for text with baseline at y."""
    hbfont, tt, gs, upem = _font(font_path)
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    hb.shape(hbfont, buf, {"kern": True, "liga": True})
    scale = size / upem
    order = tt.getGlyphOrder()
    pen = SVGPathPen(gs)
    cx = 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = order[info.codepoint]
        tp = TransformPen(pen, (scale, 0, 0, -scale, x + (cx + pos.x_offset) * scale, y - pos.y_offset * scale))
        gs[name].draw(tp)
        cx += pos.x_advance + tracking * upem
    return pen.getCommands(), (cx - tracking * upem) * scale

def cap_height(font_path, size):
    hbfont, tt, gs, upem = _font(font_path)
    return tt["OS/2"].sCapHeight * size / upem
