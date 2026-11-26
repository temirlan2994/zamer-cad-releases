# Zamer CAD mark: a folding ruler folded into the letter Z.
import math

YEL = "#FFC72C"        # ruler face
YEL_EDGE = "#E3A60C"   # under-bar shade
INK = "#0F1B33"        # ticks
PALETTES = {
    "navy": ("#16284A", "#0A152C", "#3D7BFF", 0.10, 0.18),
    "blue": ("#2C7DFF", "#0F47C7", "#FFFFFF", 0.07, 0.13),
}

def _seg_frame(p, q):
    (x1, y1), (x2, y2) = p, q
    L = math.hypot(x2 - x1, y2 - y1)
    ux, uy = (x2 - x1) / L, (y2 - y1) / L
    return L, ux, uy, -uy, ux

def segment(p, q, r, round_start=True, round_end=True, corner=26):
    """Ruler segment p→q, half-width r. Rounded (hinge) ends or square ends with soft corners."""
    L, ux, uy, nx, ny = _seg_frame(p, q)
    (x1, y1), (x2, y2) = p, q
    def pt(t, s):  # t along, s across
        return (x1 + ux * t + nx * s, y1 + uy * t + ny * s)
    d = []
    a = pt(0, r); d.append(f"M{a[0]:.1f},{a[1]:.1f}")
    if round_end:
        b = pt(L, r); c = pt(L, -r)
        d.append(f"L{b[0]:.1f},{b[1]:.1f} A{r},{r} 0 0 0 {c[0]:.1f},{c[1]:.1f}")
    else:
        e = r  # square end extends r beyond q so the end looks like a ruler tip
        b1 = pt(L + e - corner, r); b2 = pt(L + e, r - corner); c1 = pt(L + e, -r + corner); c2 = pt(L + e - corner, -r)
        d.append(f"L{b1[0]:.1f},{b1[1]:.1f} Q{pt(L + e, r)[0]:.1f},{pt(L + e, r)[1]:.1f} {b2[0]:.1f},{b2[1]:.1f}")
        d.append(f"L{c1[0]:.1f},{c1[1]:.1f} Q{pt(L + e, -r)[0]:.1f},{pt(L + e, -r)[1]:.1f} {c2[0]:.1f},{c2[1]:.1f}")
    if round_start:
        f = pt(0, -r)
        d.append(f"L{f[0]:.1f},{f[1]:.1f} A{r},{r} 0 0 0 {a[0]:.1f},{a[1]:.1f} Z")
    else:
        e = r
        f1 = pt(-e + corner, -r); f2 = pt(-e, -r + corner); g1 = pt(-e, r - corner); g2 = pt(-e + corner, r)
        d.append(f"L{f1[0]:.1f},{f1[1]:.1f} Q{pt(-e, -r)[0]:.1f},{pt(-e, -r)[1]:.1f} {f2[0]:.1f},{f2[1]:.1f}")
        d.append(f"L{g1[0]:.1f},{g1[1]:.1f} Q{pt(-e, r)[0]:.1f},{pt(-e, r)[1]:.1f} {g2[0]:.1f},{g2[1]:.1f} Z")
    return " ".join(d)

def ticks(p, q, r, side, t0, t1, step, color=INK, scale=1.0):
    L, ux, uy, nx, ny = _seg_frame(p, q)
    nx, ny = nx * side, ny * side
    (x1, y1) = p
    out, i, t = [], 0, t0
    while t <= L - t1 + 0.1:
        big = i % 5 == 0
        mid = i % 5 != 0 and i % 2 == 0 and False
        ln = r * (0.72 if big else 0.40)
        w = (10 if big else 7.5) * scale
        bx, by = x1 + ux * t + nx * (r - 2), y1 + uy * t + ny * (r - 2)
        ex, ey = bx - nx * ln, by - ny * ln
        out.append(f'<line x1="{bx:.1f}" y1="{by:.1f}" x2="{ex:.1f}" y2="{ey:.1f}" stroke="{color}" stroke-width="{w:.1f}" stroke-linecap="round"/>')
        t += step; i += 1
    return "".join(out)

def rivet(x, y, r=24):
    return (f'<circle cx="{x}" cy="{y}" r="{r}" fill="#DDE4EE"/>'
            f'<circle cx="{x}" cy="{y}" r="{r}" fill="none" stroke="#8C98AB" stroke-width="5"/>'
            f'<circle cx="{x-7}" cy="{y-8}" r="{r*0.32:.1f}" fill="#FFFFFF"/>')

def z_mark(cx=512, cy=512, w=620, h=560, T=132, with_shadow=True, flat=False, tick_color=INK):
    """Return SVG group of the ruler-Z centred at (cx,cy). w,h = centreline box."""
    r = T / 2
    A = (cx - w / 2, cy - h / 2); B = (cx + w / 2 - 6, cy - h / 2)
    C = (cx - w / 2 + 6, cy + h / 2); D = (cx + w / 2, cy + h / 2)
    g = ['<g filter="url(#shadow)">' if with_shadow else '<g>']
    # diagonal (under)
    g.append(f'<path d="{segment(B, C, r)}" fill="{"url(#ruler)" if not flat else YEL}"/>')
    g.append(ticks(B, C, r, -1, 92, 92, 29, tick_color))
    # bars (over): top A→B (square start, hinge end), bottom C→D (hinge start, square end)
    for p, q, rs, re in ((A, B, False, True), (C, D, True, False)):
        g.append(f'<path d="{segment(p, q, r, rs, re)}" fill="{"url(#ruler)" if not flat else YEL}"/>')
    g.append(ticks(A, B, r, -1, 4, 70, 29, tick_color))
    g.append(ticks(C, D, r, -1, 70, 4, 29, tick_color))
    if not flat:
        for (x, y) in (B, C):
            g.append(rivet(x, y))
    else:
        for (x, y) in (B, C):
            g.append(f'<circle cx="{x}" cy="{y}" r="22" fill="{tick_color}"/>')
    g.append('</g>')
    return "".join(g)

def icon_svg(palette="navy", rounded=True, grid=True, size=1024, mark_kw=None):
    c0, c1, gc, op1, op2 = PALETTES[palette]
    rx = 230 if rounded else 0
    grid_paths = ""
    if grid:
        for v in range(64, 1024, 64):
            major = v % 256 == 0
            grid_paths += f'<path d="M{v} 0V1024M0 {v}H1024" stroke="{gc}" stroke-opacity="{op2 if major else op1}" stroke-width="{3 if major else 2}"/>'
    shadow_op = 0.55 if palette == "navy" else 0.38
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="{size}" height="{size}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c0}"/><stop offset="1" stop-color="{c1}"/></linearGradient>
<radialGradient id="glow" cx="0.5" cy="0.42" r="0.6"><stop offset="0" stop-color="#3D7BFF" stop-opacity="{0.28 if palette == 'navy' else 0.0}"/><stop offset="1" stop-color="#3D7BFF" stop-opacity="0"/></radialGradient>
<clipPath id="clip"><rect width="1024" height="1024" rx="{rx}"/></clipPath>
<linearGradient id="ruler" gradientUnits="userSpaceOnUse" x1="0" y1="180" x2="0" y2="860"><stop offset="0" stop-color="#FFD54F"/><stop offset="1" stop-color="#FFBE1A"/></linearGradient>
<filter id="shadow" x="-25%" y="-25%" width="150%" height="160%"><feDropShadow dx="0" dy="20" stdDeviation="24" flood-color="#020814" flood-opacity="{shadow_op}"/></filter>
</defs>
<g clip-path="url(#clip)"><rect width="1024" height="1024" fill="url(#bg)"/><rect width="1024" height="1024" fill="url(#glow)"/>{grid_paths}</g>
{z_mark(**(mark_kw or {}))}
</svg>'''

def z_points(cx=512, cy=512, w=650, h=584):
    return ((cx - w / 2, cy - h / 2), (cx + w / 2 - 6, cy - h / 2), (cx - w / 2 + 6, cy + h / 2), (cx + w / 2, cy + h / 2))

def silhouette(color, hole_color=None, cx=512, cy=512, w=650, h=584, T=140, holes=True, mask_id="zm"):
    """Flat single-colour Z ruler (no ticks/shadow); rivets as holes via mask."""
    r = T / 2
    A, B, C, D = z_points(cx, cy, w, h)
    shape = (f'<path d="{segment(B, C, r)}"/><path d="{segment(A, B, r, False, True)}"/>'
             f'<path d="{segment(C, D, r, True, False)}"/>')
    if not holes:
        return f'<g fill="{color}">{shape}</g>'
    hole = "".join(f'<circle cx="{x}" cy="{y}" r="{r * 0.36:.1f}" fill="#000"/>' for (x, y) in (B, C))
    return (f'<mask id="{mask_id}"><rect x="-2000" y="-2000" width="6000" height="6000" fill="#fff"/>{hole}</mask>'
            f'<g fill="{color}" mask="url(#{mask_id})">{shape}</g>')

def simple_icon_svg(size=1024, rounded=True):
    """Small-size icon: navy tile + flat yellow Z, no ticks/grid (favicons ≤ 48 px)."""
    rx = 230 if rounded else 0
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="{size}" height="{size}">'
            f'<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#16284A"/><stop offset="1" stop-color="#0A152C"/></linearGradient></defs>'
            f'<rect width="1024" height="1024" rx="{rx}" fill="url(#bg)"/>'
            f'{silhouette("#FFC72C", w=690, h=620, T=176, mask_id="zs")}</svg>')
