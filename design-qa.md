# Design QA

final result: passed

## Scope

Interactive mobile CAD prototype for Zamer CAD at `http://127.0.0.1:4187`.

## Checked

- Mobile viewport `390 x 844`.
- App shell fits the viewport without page scroll.
- Canvas loads and renders the floor plan.
- Active tool defaults to `Линия`.
- Fixed center cursor is visible over the canvas.
- Dragging the canvas pans the plan under the center cursor.
- A short canvas tap sets the first point at the center cursor.
- Moving the plan after the first point updates dynamic segment length/angle.
- A second short canvas tap commits the segment.
- Dynamic line input appears directly on the active segment.
- Drag test updated values to `1650 мм` and `0°`.
- Center-cursor test updated values to `1050 мм` and `0°`, then committed a new line.
- Free-angle test produced `1275 мм` and `11°`, confirming drawing is not locked to 90 degrees.
- Polar tracking test produced `1485 мм` and `315°`, confirming 45-degree trajectory magnetism.
- Top snap row contains `Сетка`, `Конец`, `Середина`, and trajectory `↗` controls.
- Top trajectory snap icon `↗` toggles polar tracking on/off.
- Automatic wall dimension labels render on the dimensions layer.
- Layer manager opens, lists 4 layers, and hiding `Мебель` changes visible objects from 13 to 10.
- Export sheet opens with PDF, DXF, DWG, and IFC options.
- DXF export action runs from the export sheet without console errors.
- Bottom always-visible furniture strip was removed from the command panel.
- Left `Мебель` tool opens a furniture library bottom sheet.
- Furniture sheet shows top tabs, side categories, and size cards.
- Furniture sheet supports three positions: collapsed tabs-only, half-open library, and full-open library.
- Tapping the sheet handle cycles half -> full -> collapsed -> half.
- Dragging the sheet handle snaps to the nearest of the three furniture sheet positions.
- Furniture cards now use local MIT-licensed SVG floor plan symbols instead of temporary CSS thumbnails.
- Furniture canvas blocks now render from the same SVG symbol set when assets are loaded, with vector fallbacks.
- Furniture library categories now update per tab: furniture, doors, windows, kitchen, bath, and decor all show relevant categories and non-empty cards.
- Furniture mode hides the center cursor and keeps the furniture library open.
- Canvas now tracks multiple active pointers and supports two-finger pinch zoom around the midpoint between fingers.
- Pinch zoom suppresses accidental tap/line commits after the gesture ends.
- Desktop in-app browser loaded `app.js?v=23` with no console errors; final multi-touch feel should be checked on the phone because the desktop test surface cannot emit real two-finger touch events.
- Mobile keyboard handling now freezes the CAD app height and uses `visualViewport`/keyboard inset only to lift the bottom command inputs, so the drawing workspace is not pushed upward when the numeric keyboard opens.
- Viewport meta includes `interactive-widget=overlays-content` for Android Chrome keyboard overlay behavior.
- Public Cloudflare URL returned `app.js?v=24`, `styles.css?v=23`, and the keyboard viewport flag.
- Dimension entities now render as real dimension lines with extension lines, arrowheads on both ends, and a centered millimeter value label instead of a plain line.
- Active dimension placement preview uses the same arrow-and-label geometry while drawing.
- Tapping existing furniture on the plan selects it directly in furniture mode.
- Dragging a furniture card from the bottom library onto the visible plan inserts and selects that block.
- Top-right properties panel was removed; length/angle remain on the active segment.
- Canvas stats pill (`13 объектов`, `13 видно`, `тайлы`) was removed from the drawing surface.
- Topbar places undo and redo buttons next to each other.
- Active segment now shows a CAD-style angle arc from the horizontal baseline at the start point to the current line direction.
- Angle arc test produced `890 mm` and `142 deg`, with the degree label placed on the arc.
- Angle arc now uses the nearest adjacent wall/line as its baseline; test produced `45 deg` from the nearby wall.
- Wall rendering now draws joined wall shells and cores in layer passes, so connected corners read as one clean Revit-style joint.
- Select mode hides the center cursor so objects can be selected directly by touch.
- Select mode drag test moved a furniture block by finger while keeping empty-space pan behavior available.
- Dimension mode keeps the center cursor visible, auto-enables endpoint/corner snap, and shows a blue snap marker on nearby object corners.
- Dimension snap test created a `5200 mm` dimension from two snapped wall corners.
- `Линия` now creates one standalone segment and stops after the second point instead of continuing like a polyline.
- Status hint chip now sits at the top of the canvas after the first tap, leaving the bottom command panel clear.
- Bottom command row no longer shows `Точка` or `OK`; drawing commits with short canvas taps.
- Snap and grid controls moved to the top row.
- Bottom command panel with `Длина` and `Угол` was removed.
- Active line/wall preview now shows editable length and angle fields directly on the segment/angle arc.
- Pressing Enter or leaving the inline length/angle field applies the typed value and locks the endpoint until the segment is committed.
- Local server returned `styles.css?v=24` and `app.js?v=27`; browser test confirmed no `.command-panel` node and visible inline editors while drawing.
- Inline length/angle labels now avoid overlapping each other; angle label shifts away from the length label when their boxes intersect.
- Inline label border is hidden by default and only appears on focus, so the numbers read like CAD annotation instead of permanent form fields.
- Local server returned `styles.css?v=25` and `app.js?v=28`; JavaScript syntax passes bundled Node check.
- Light theme is active by default.
- Furniture library is visible in the bottom panel.
- DXF export button runs without console errors and updates export status.
- JavaScript syntax passes `node --check`.
- Server returns `200` for `index.html`, `styles.css`, and `app.js`.

## Evidence

- `prototype/screenshot-initial.png`
- `prototype/screenshot-drawing.png`
- `prototype/screenshot-final.png`
- `prototype/screenshot-upgraded.png`
- `prototype/screenshot-center-cursor.png`
- `prototype/screenshot-polar-tracking.png`
- `prototype/screenshot-furniture-sheet-clean.png`
- `prototype/screenshot-furniture-sheet-peek.png`
- `prototype/screenshot-furniture-sheet-half.png`
- `prototype/screenshot-furniture-sheet-full.png`
- `prototype/screenshot-furniture-svg-library-final.png`
- `prototype/screenshot-furniture-selected.png`
- `prototype/screenshot-no-properties-panel.png`
- `prototype/screenshot-no-stats.png`
- `prototype/screenshot-topbar-undo-redo.png`
- `prototype/screenshot-single-line-mode.png`
- `prototype/screenshot-angle-arc.png`
- `prototype/screenshot-angle-from-nearest-line.png`
- `prototype/screenshot-wall-joins-v13.png`
- `prototype/screenshot-select-no-cursor-final.png`
- `prototype/screenshot-select-drag-object.png`
- `prototype/screenshot-line-cursor-visible-after-select.png`
- `prototype/screenshot-dimension-tool-cursor.png`
- `prototype/screenshot-dimension-snap-corner.png`
- `prototype/screenshot-dimension-created-snap.png`
- `prototype/screenshot-status-top.png`
- `prototype/screenshot-no-point-ok-buttons.png`
- `prototype/screenshot-top-snaps.png`
- `prototype/screenshot-furniture-drag-drop.png`

## Follow-Up Polish

- Replace temporary text glyph icons with a proper icon set in the APK implementation.
- Add a real export picker for PDF, DXF, DWG, and later IFC.
- Move CAD core into shared modules before porting to Flutter/Kotlin.
