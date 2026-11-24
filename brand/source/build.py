# Сборка SVG логотипа Zamer CAD: python3 brand/source/build.py brand/svg
# Нужны: pip install fonttools uharfbuzz и шрифт Inter Display (SIL OFL).
import sys, os, re
sys.path.insert(0, os.path.dirname(__file__))
from mark import icon_svg, simple_icon_svg, silhouette, z_mark
from text import text_path, cap_height
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True)
F = "/usr/share/fonts/opentype/inter/"
BLACK = F + "InterDisplay-Black.otf"
NAVY, YEL, BLUE = "#0F1D38", "#FFC72C", "#1F75FF"
KW = dict(w=650, h=584, T=140)

def w(name, s): open(os.path.join(OUT, name), "w").write(s)
def inner(s): return re.sub(r'^<svg[^>]*>|</svg>\s*$', '', s.strip())

# 1. App icons
w("zamer-cad-icon.svg", icon_svg("navy", rounded=True, mark_kw=KW))
w("zamer-cad-icon-square.svg", icon_svg("navy", rounded=False, mark_kw=KW))      # Google Play (store applies its own mask)
w("zamer-cad-icon-small.svg", simple_icon_svg())                                   # favicons ≤ 48 px
w("zamer-cad-icon-small-square.svg", simple_icon_svg(rounded=False))

# 2. Android adaptive icon layers (108 dp canvas, content inside the 66 dp safe circle)
bg_only = re.sub(r'<g filter="url\(#shadow\)">.*</g>\s*</svg>$', '</svg>', icon_svg("navy", rounded=False, mark_kw=KW).strip(), flags=re.S)
w("android-background.svg", bg_only)
fg = icon_svg("navy", rounded=False, mark_kw=KW)
defs = re.search(r'<defs>.*?</defs>', fg, re.S).group(0)
w("android-foreground.svg", f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">{defs}'
  f'<g transform="translate(512 512) scale(0.585) translate(-512 -512)">{z_mark(**KW)}</g></svg>')
w("android-monochrome.svg", f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">'
  f'<g transform="translate(512 512) scale(0.585) translate(-512 -512)">{silhouette("#FFFFFF", mask_id="zmono", **KW)}</g></svg>')

# 3. Logo lockups (icon + wordmark, text converted to paths)
def lockup(theme):
    size, icon, gap = 200, 300, 64
    ch = cap_height(BLACK, size)
    base = icon / 2 + ch / 2
    x0 = icon + gap
    zamer_d, zamer_w = text_path("Zamer", BLACK, size, x0, base, tracking=-0.025)
    fgc = "#FFFFFF" if theme == "dark" else NAVY
    tag_x = x0 + zamer_w + 40
    tsize = size * 0.62
    _, cad_w = text_path("CAD", BLACK, tsize, 0, 0, tracking=0.04)
    pad_x, tag_h = 34, ch * 1.06
    tag_w = cad_w + pad_x * 2
    tag_y = base - ch - (tag_h - ch) / 2
    tch = cap_height(BLACK, tsize)
    cad_d, _ = text_path("CAD", BLACK, tsize, tag_x + pad_x, tag_y + tag_h / 2 + tch / 2 + 6, tracking=0.04)
    ticks = "".join(f'<path d="M{tag_x + 22 + i * 19:.1f} {tag_y:.1f}v{(16 if i % 5 == 0 else 9)}" stroke="{NAVY}" stroke-width="4" stroke-linecap="round"/>'
                    for i in range(int((tag_w - 40) / 19) + 1))
    W = int(tag_x + tag_w + 8)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {icon}" width="{W}" height="{icon}">'
            f'<g transform="scale({icon / 1024})">{inner(icon_svg("navy", mark_kw=KW))}</g>'
            f'<path d="{zamer_d}" fill="{fgc}"/><rect x="{tag_x:.1f}" y="{tag_y:.1f}" width="{tag_w:.1f}" height="{tag_h:.1f}" rx="16" fill="{YEL}"/>{ticks}'
            f'<path d="{cad_d}" fill="{NAVY}"/></svg>')
w("zamer-cad-logo.svg", lockup("light"))
w("zamer-cad-logo-dark.svg", lockup("dark"))

# 4. One-colour marks
for name, col in (("zamer-cad-mark-navy.svg", NAVY), ("zamer-cad-mark-white.svg", "#FFFFFF"), ("zamer-cad-mark-yellow.svg", YEL)):
    w(name, f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="100 130 824 764" width="824" height="764">{silhouette(col, mask_id="m" + name[16:20], **KW)}</svg>')
print(sorted(os.listdir(OUT)))
