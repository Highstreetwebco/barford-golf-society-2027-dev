# ParClub reference review — 14 September 2026

## Evidence and limits

Reviewed the [App Store listing](https://apps.apple.com/gb/app/parclub-golf-society-app/id6772982648), [official website](https://parclub.app/), [captains guide](https://parclub.app/captains/), and the [interactive public portal demo](https://parclub.app/demo/). Inspected the rendered Overview and Meetings screens and their navigation. The demo explicitly uses invented records. The installed iPhone app and authenticated member interactions were not available to inspect; descriptions of those interactions below are advertised capabilities, not independently tested behaviour. The portal has society-specific competition rules, so it is not a specification for Barford’s scoring.

## Feature mapping

| ParClub pattern | Barford implementation / decision |
| --- | --- |
| Fixtures and member registration | Existing RSVP, reserve promotion, walking/buggy and tee preference retained. Added Upcoming, My bookings, Past and All events filters with counts and URL persistence. Guests see public filters and retain named guest RSVP. |
| A joined round as the centre of the day | Full event hub now exposes roster, directions, personal payment, results and photos alongside group and scorecard. Dashboard still prioritises today’s scorecard. |
| Captain information | Existing event notes now appear as visible committee round information, rather than being hidden in event options. Society-wide posts/chat remain a separate feature. |
| Pairings and tee times | Existing committee pairing tools and published personal groups retained. No unverified balancing algorithm copied. |
| Money overview | Added outstanding total, number of events due, unpriced bookings and refresh. Totals use the existing eligibility rules; reserve, cancelled, refunded, waived and paid bookings do not ask for payment. This is an event-fee summary, not a bank balance or full society cash ledger. |
| Direct payment links | Official materials describe external captain payment methods. No verified Barford payment destination is configured, so the existing committee contact flow remains. Never mark a payment paid just because a payment link was opened. |
| Shareable round report | Published round results can be reviewed, copied or sent through the device share sheet. Includes committee-recorded awards and all scored members, with equal point totals explicitly labelled as ties; excludes DNP and missing scores. User chooses recipients and sends. No private payment details or contact data included. |
| Hole-by-hole group scoring | Existing single nominated scorer, viewer mode, local resilience, map links and committee submission retained. |
| Live competition board | Existing live group scorecard remains distinct from the published season leaderboard. No new whole-field live leaderboard added in this change. |
| Order of Merit and handicaps | Existing Barford 2027 rules remain authoritative, including best five of seven. ParClub demo’s best-three finishing-position method and penalties are not copied. |
| GPS/hole views | Existing course map and offline fallback retained. ParClub’s advertised national course coverage does not supply licensed course data to Barford. |
| Knockouts, tours and eclectic | Advertised separate competition features. Not introduced by this change; require their own rules, data model and validation. |
| Side games | Barford already supports longest-drive and nearest-the-pin holes and committee-recorded winners. These remain; skins and twos are separate additions. |
| Paper scorecard recognition | Barford already has an admin screenshot reader for course par, yardage and stroke index. This differs from ParClub’s advertised recognition of a player’s completed scorecard. Completed player-score recognition is not added. |
| Chat and direct messages | Advertised capability; not added. Existing user-controlled committee message drafts remain. |
| External tee-time booking | Advertised in App Store release notes. Separate from RSVP to a society event; no invented course booking links added. |
| Public shareable standings and casting | Advertised captain feature. Barford’s member-only results access retained; a share report is an explicit user action, not public database access. |
| Invitations, export and handover | Advertised management features. No role/ownership changes made. Header Admin shortcut continues to require verified admin access. |

## Delivery boundaries

This change adapts demonstrated organisation and overlapping workflows; it is not a clone or a claim of feature parity. It uses Barford’s own styling and existing database contracts. No Supabase migration is needed. No production event or membership data was modified for testing.
