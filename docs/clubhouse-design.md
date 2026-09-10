# Barford clubhouse redesign

Research and design review: 10 September 2026.

These ten leading golf references form a design shortlist, not an objective popularity ranking. Research used official websites and published app imagery; it did not include signing into their apps. PGA TOUR's website blocked access, so its official app listing supplied the interaction evidence.

| Reference | Useful design lesson | Barford application |
| --- | --- | --- |
| [The Masters](https://www.masters.com/index.html) | White navigation, green editorial panels, serif headlines and restrained yellow accents. | Clear wordmark, green event headings and a restrained gold rule. |
| [St Andrews Links](https://www.standrews.com/homepage) | Heritage typography, strong photography and a prominent tee-time booking action. | Club character with one obvious event action; no moving carousel. |
| [PGA TOUR app](https://play.google.com/store/apps/details?hl=en_GB&id=com.tour.pgatour) | Leaderboard entries lead to scorecards and round context. | Expandable results and consistent event-to-scorecard navigation. |
| [Topgolf UK](https://topgolf.com/uk/) | People-focused photography, clear booking and short practical instructions. | Real society photography and plain action labels. |
| [Titleist](https://www.titleist.com/) | Crisp white space, confident images and restrained visual details. | Clean reading surfaces, consistent spacing and fewer decorative effects. |
| [Hole19](https://www.hole19golf.com/hole19/) | Light panels, clear number hierarchy and labelled navigation. | Large headline facts, with optional detail kept together. |
| [18Birdies](https://18birdies.com/) | Strong contrast, a distinct score action and labelled bottom tabs. | Preserve the four member tabs and give scoring a prominent control. |
| [Golfshot](https://golfshot.com/) | Large yardages and persistent hole context. | Readable distances, clear hole information and an obvious return to scoring. |
| [Arccos](https://www.arccosgolf.com/blogs/community/the-new-arccos-app-is-now-on-android) | Purposeful sections, strong figures and plain-language interpretation. | Pair important facts with meaning and a useful next step. |
| [TheGrint](https://thegrint.com/) | Active-player context and score entry kept together. | Make the selected golfer unmistakable when entering strokes. |

## Barford's own direction

A modern society clubhouse: racing green, crisp white reading surfaces, warm gold details, editorial serif titles and clear sans-serif controls. The homepage uses an existing Barford society photograph (`legacy-17.webp`), not a competitor's imagery or an invented course.

The redesign retains the member workflow, accounts, personal colours, bookings, reserve list, payments, tee groups, scoring, offline recovery, GPS, results, gallery, society trips, shop and committee tools.

- Member sign-in is the first public action.
- The dashboard keeps the next event and its primary action prominent.
- Events use readable date tickets, booking status and grouped practical facts.
- The leaderboard uses full names, clear totals and expandable details.
- Account forms remain on light surfaces, with large labelled fields.
- Scoring scrolls naturally, with generous player rows and number buttons.
- The course view keeps distances, hole navigation and return-to-score controls in predictable places.
- Personal colours affect brand panels and accents; text colour is chosen by measured contrast.

Regular reading text is 18px, primary controls are at least 48px high, and score keys are at least 64px. The layout respects safe-area insets, keyboard focus, reduced motion and hidden authentication/ownership states. Existing data operations and access controls are unchanged.

## Implementation

`clubhouse.css` replaces the retired decorative theme layers on member pages. `clubhouse-course.css` styles the existing map interface. Shared event renderers supply the new heading/date structure while keeping their IDs, action hooks and server contracts. The service worker includes both new stylesheets and the society image in its own namespaced cache.
