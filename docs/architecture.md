# Zamer CAD Architecture

## Product Direction

Zamer CAD is a professional manual measurement tool for designers. It is not an AR measuring toy. The user measures with a physical tape measure, draws lines and walls on the phone, enters exact values, places furniture blocks, and exports to CAD/BIM/print formats.

The interface direction is light and simple like Sketch/Figma, with optional dark CAD mode and professional command input like AutoCAD Mobile.

## Recommended Architecture

```text
Mobile Shell
  Theme, navigation, gestures, toolbars, panels

CAD Core
  Document model, entities, blocks, layers, styles

Geometry Engine
  Coordinates, snapping, angles, dimensions, transforms

Renderer
  Visible-entity culling, grid, lines, labels, handles

Command System
  Draw, wall, dimension, move, rotate, trim, offset, undo, redo

Storage
  .zamer project file, autosave, versioned schema

Export Layer
  PDF local, DXF local, DWG via ODA/Autodesk service, IFC later
```

## Mobile Technology Recommendation

Preferred APK path:

```text
Flutter UI + custom Canvas/CustomPainter + native export bridges
```

Why:

- Fast UI iteration for light/dark mode and designer-grade interface.
- Good custom drawing surface.
- Easier future iOS support.
- CAD core can be kept independent from Flutter widgets.

Alternative:

```text
Kotlin Android + custom View/Canvas + native modules
```

Use this if the project must stay Android-only and the team prefers maximum native control.

## Core Data Model

The app should store its own project model instead of using DWG as the live editing format.

```text
Project
  id
  units: millimeters
  scale
  layers[]
  entities[]
  blocks[]
  styles[]
  viewState

Entity
  id
  type: line | wall | polyline | dimension | text | blockRef | room
  layerId
  geometry
  style
  metadata

Block
  id
  name
  category: furniture | doors | windows | sanitary | kitchen
  entities[]

BlockRef
  blockId
  position
  rotation
  scale
```

## Performance Rules

For many lines and furniture blocks, performance should be designed in from day one.

- Store all geometry in world coordinates, millimeters by default.
- Draw only visible entities inside the current viewport.
- Use spatial indexing: R-tree for CAD entities, quadtree only if simpler.
- Keep furniture as block references. Do not copy thousands of child lines.
- Use command-based undo/redo, not full document copies.
- Batch redraws with dirty regions or requestAnimationFrame.
- Run export/import in background isolates/workers.
- Keep labels and handles as overlay primitives, not separate heavyweight UI widgets.

## Dynamic Input Requirement

While drawing a line or wall, the active segment must display live information on the segment:

```text
3240 mm
90 deg
```

The bottom command bar mirrors the same values and allows exact numeric entry. This is required for professional tape-measure workflow.

## Mobile Cursor Workflow

The drawing mechanic should follow the AutoCAD mobile style rather than freehand finger drawing:

- A fixed cursor/crosshair stays in the center of the drawing viewport.
- The user pans/zooms the plan underneath the cursor.
- The `Point` action places the next command point at the cursor location.
- After the first point, the preview segment runs from the previous point to the center cursor.
- Length and angle update live on the segment and in the command bar.
- Exact length/angle input creates the next segment without needing finger precision.
- Polar tracking is magnetic, not restrictive: the user can draw any angle, while the app snaps only when the cursor is near 0/45/90/135-degree trajectories.
- A bottom trajectory snap icon controls this magnetic tracking independently from grid, endpoint, and midpoint snaps.

This is more accurate for site measurement because the finger does not cover the target point.

## First APK Scope

Version 0.1 should include:

- Light and dark themes.
- Pan/zoom drafting canvas.
- Draw line and wall.
- Dynamic length/angle label on active segment.
- Exact length and angle input.
- Basic snapping: endpoint, midpoint, angle lock, grid.
- Select/move/rotate.
- Dimension entities.
- Layers.
- Furniture block library.
- Save/open `.zamer`.
- PDF export.
- DXF export.

Current prototype now also demonstrates:

- Layer visibility affecting rendering, picking, snapping, and export.
- Automatic dimension labels on visible wall segments.
- Export picker for PDF, DXF, DWG, and IFC paths.
- Object/visible counters as the beginning of performance feedback.

Version 0.2:

- Trim, extend, offset, mirror.
- Door/window smart blocks.
- DXF import.
- Room detection and area schedule.
- More furniture categories.

Version 0.3:

- DWG export through ODA SDK or server conversion.
- IFC export for BIM workflows.
- Cloud library and team templates.
