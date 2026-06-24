# Furniture Library

Add new 2D symbols in two places:

1. Put SVG files into `custom/`.
2. Add entries to `catalog.json`.

Example:

```json
{
  "id": "custom-armchair-01",
  "tab": "furniture",
  "category": "chairs",
  "kind": "chair",
  "title": "Кресло 01",
  "width": 700,
  "height": 750,
  "thumb": { "type": "single", "src": "../library/custom/armchair-01.svg" }
}
```

Tabs:
- `furniture`
- `doors`
- `windows`
- `kitchen`
- `bath`
- `decor`

Common categories:
- `sofas`, `beds`, `tables`, `chairs`, `storage`, `cabinets`
- `swing`
- `windows`
- `kitchen`
- `bath`
- `decor`

Keep SVG symbols simple, black/transparent, top-view, and without embedded scripts.
