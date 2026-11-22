# Zamer CAD Tool Audit

Date: 2026-06-25
Scope: mobile CAD prototype tools, top controls, furniture sheet, selection actions, line/wall/dimension flows.

## Captured Steps

1. Start state after reload
   - Screenshot: `02-start-after-fix.png`, `24-final-start.png`
   - Health: fixed. App now opens on `Линия`, not `Объект`.

2. Select tool
   - Screenshot: `04-select.png`
   - Health: good. Works as an escape/cancel tool and hides menus.

3. Line tool and draw menu
   - Screenshot: `05-line-menu.png`
   - Health: good. Bottom state matches real tool. Menu hides on first canvas tap and after completion.

4. Circle subtool
   - Screenshot: `06-circle-selected.png`
   - Health: good. Bottom tool label changes to `Круг`, so the active subtool is visible.

5. Wall tool
   - Screenshot: `07-wall.png`, `23-line-wall-finish.png`
   - Health: fixed. Completion status now uses correct grammar.

6. Dimension tool
   - Screenshot: `08-dimension.png`, `22-dimension-finish.png`
   - Health: usable. Dimension creates successfully and remains active for repeated dimensions.

7. Selection tools
   - Screenshot: `09-selection-window-menu.png`, `10-selection-lasso.png`, `21-wall-selection-actions.png`
   - Health: good. Window/lasso modes activate correctly. Wall selection shows action toolbar.

8. Furniture/object sheet
   - Screenshot: `11-object-sheet.png`, `17-furniture-full.png`, `19-furniture-peek-tabs.png`
   - Health: fixed. Library no longer hijacks initial tool. Peek state now shows category tabs only.

9. Layers sheet
   - Screenshot: `13-layers-sheet.png`
   - Health: good. Layer toggles are clear and readable.

10. Export sheet
    - Screenshot: `14-export-sheet.png`
    - Health: good. DXF is clearly marked as ready; DWG/IFC communicate future/server status.

11. Dark theme
    - Screenshot: `15-theme-dark.png`
    - Health: good. Contrast and CAD feel are strong.

## Fixed During Audit

- Prevented furniture library hydration from switching the active tool to `Объект` after reload.
- Renamed top snap control from `Точка` to `Конец`.
- Renamed dimension snap badge from `Точка` to `Конец`.
- Let status chips wrap to two readable lines instead of cutting important instructions.
- Hid heavy furniture list scrollbars.
- Reworked furniture `peek` position to show category tabs (`Мебель`, `Двери`, `Окна`, `Кухня`, `Санузел`, `Декор`) above the bottom tool rail.
- Synced furniture peek height between CSS and JS drag snapping.
- Removed unreachable dead code in selection actions.
- Fixed completion copy: `Линия завершена`, `Стена завершена`, `Дуга завершена`.

## Remaining UX Risks

1. Selection action toolbar can overflow horizontally.
   - Evidence: `21-wall-selection-actions.png`.
   - Recommendation: keep destructive `Удалить` visible as a separate red icon or use a two-row compact action bar.

2. Dimension placement can overlap dense furniture/wall areas.
   - Evidence: `22-dimension-finish.png`.
   - Recommendation: add smarter automatic offset or collision avoidance for dimension labels.

3. Export close leaves the last export status in the status chip.
   - Evidence: `14-export-sheet.png`, `15-theme-dark.png`.
   - Recommendation: when closing sheets, restore the current tool hint.

4. Furniture tabs in peek are tight on narrow screens.
   - Evidence: `19-furniture-peek-tabs.png`.
   - Recommendation: acceptable after fix, but a segmented compact style could make it more robust.

5. Object/furniture editing uses a different model from wall/line actions.
   - Evidence: `11-object-sheet.png`, `21-wall-selection-actions.png`.
   - Recommendation: keep this intentional, but add a small selected-object affordance so users understand furniture moves directly by finger.

## Accessibility Notes

- Most icon buttons have `aria-label`; bottom tool buttons rely mostly on visible labels.
- Touch targets are generally large enough.
- The status chip now wraps, improving readable instructions.
- More testing is still needed for keyboard-only operation and screen reader reading order.
