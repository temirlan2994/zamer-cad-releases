# Export Strategy

## Short Answer

Use multiple formats:

```text
.zamer - native editable project
PDF    - client/print/share
DXF    - reliable CAD exchange
DWG    - professional AutoCAD ecosystem exchange
IFC    - BIM exchange for Revit/Archicad
OBJ/glTF/FBX - later for 3D workflows
```

DWG is important, but it should not be the internal project format.

## Why Not DWG Internally

DWG is proprietary and complex. Using it as the live format makes every edit, autosave, undo, furniture block, and mobile performance decision depend on a heavyweight external format.

The app should edit `.zamer`, then export.

## DXF First

DXF is the best first CAD export target:

- Easier to generate.
- Works with AutoCAD, Archicad, SketchUp, Revit, 3ds Max, and many CAD tools.
- Good for lines, polylines, layers, blocks, dimensions, text, and 2D plans.

DXF export should preserve:

- Units in millimeters.
- Layers.
- Line colors and line weights.
- Blocks for furniture.
- Dimension text and extension lines.
- Room labels and areas.

## DWG Path

Professional DWG export should use one of these paths:

1. ODA Drawings SDK.
2. Autodesk Platform Services / AutoCAD Design Automation.
3. Server-side conversion from DXF to DWG.

The MVP can ship with DXF and PDF first, then add DWG once licensing and conversion infrastructure are decided.

## IFC Path

IFC matters when exporting architecture as BIM, especially to Revit and Archicad.

Use IFC later when the app has semantic objects:

- Wall
- Door
- Window
- Room/space
- Opening
- Furniture/equipment

If the drawing is just 2D lines, DXF/DWG is better. If the drawing understands architectural objects, IFC becomes valuable.

## PDF Path

PDF should be local and immediate.

PDF export should include:

- Page size presets.
- Scale selection.
- Title block.
- Layer visibility.
- Dimension styles.
- Furniture symbols.
- Room area table.
