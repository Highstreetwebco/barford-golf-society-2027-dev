# Barford design favourites

## Fairway — earlier favourite, 15 September 2026

- Restore reference: `design-favourites/fairway-2026-09-15`
- Commit: `c93fafc4025686a06b0829034dab431e3237ba93`
- Dark forest logo header, bold sporting typography, illustrated fairway, warm white working pages.
- Selected by Jack as his favourite before exploring more designs.

Keep this branch as an unchanged reference. To restore the appearance later, bring back the relevant design files and rebuild against the current application. Do not reset the entire application and discard later feature fixes or database work.

`designs.html` compares the saved and alternative designs. Drive is now the default. Alternative designs use a URL parameter, do not write account preferences, and do not change the default for other visitors.

## Current default — Drive

Jack requested Drive be pushed to the normal live site on 15 September 2026. Pages without a design parameter now use Drive. Use `?design=fairway` to preview the saved favourite; navigation preserves this explicit choice. The favourite restore branch remains unchanged.

## Current favourite — Drive, 15 September 2026

Jack selected Drive as his new favourite before testing the Round flow.

- Restore reference: `design-favourites/drive-2026-09-15`
- Commit: 3ab644f22c6c5460d37d2535351713afc5659184
- Drive remains the live default. Round is an explicit preview at `?design=round`.
- Preserve this restore reference and the earlier Fairway reference. Restore design files against current application code rather than discarding later functional changes.

## Tee sheet — independent interface experiment

`tee-sheet.html` is a separate live fixture-board interface with its own HTML, CSS and controller. It reuses existing protected booking and scorer operations. Drive remains the saved favourite and default. Secondary links open existing feature pages. Preview on a phone with `designs.html?design=teesheet`.
