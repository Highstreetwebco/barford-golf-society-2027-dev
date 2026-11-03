# Barford Golf Society — simple 2027 site

Production site: https://barfordgolf.co.uk/

The domain serves the **Coming soon** page until Jack launches it. Enter the admin preview password to open the preparation view. The authenticated **Admin** page has **Make live for everyone**; it asks for the password again and updates one shared Supabase release flag. Cancel or an incorrect password keeps the site closed. After publication, every visitor passes directly to the homepage, including fresh devices. Member and administrator account permissions remain separate from preview access. Member pages show no preview banner or launch controls. Admin accounts default to the ordinary member view outside Admin: editing links, photo deletion and private rounds are hidden. The Member view switch in Admin saves a preference for the current account on this device; it never changes the account role. Admin remains available directly at `admin.html` without signing out.

The existing password is stored as a bcrypt hash in `baseline_private.preview_access`; it is never committed to this repository. Preview sessions expire after 12 hours. Password attempts are limited. The launch flag, password hashes and session hashes have no direct browser access. A PostgREST pre-request hook blocks all other Data API routes while closed unless the request carries a valid preview token. The `baseline-services` Edge Function applies the same gate before its existing action checks. Scheduled public weather refresh pauses until launch.

GitHub Pages and this repository still serve public static source files. The gate hides ordinary page access and protects backend data; it is not private hosting for source/assets. Existing public images are not secret. No Realtime publication is enabled on this project. The 2026 presentation evening remains at https://highstreetwebco.github.io/barford-golf-society/ with its existing backend and records.

`tests/launch-control.sql` exercises the real release flag, token expiry, throttling and direct-API guard inside a rollback transaction using a temporary fixture password. It never publishes the real site. The current browser suite uses isolated mocks to test the complete preview-to-launch journey and fresh visitors.

## Current workflow · October 2026

The 2027 site keeps the established navy, cream and tan identity and uses a small set of member journeys. Home leads with the next upcoming event, its date, tee time and booking action. The welcome message and shortcuts for **RSVP**, **Leaderboard**, **Course hole view** and **All events** follow below. Admins also see **Enter scores**. Gallery is available from the five-tab mobile navigation and the main menu, with a photo grid, swipe/arrow viewer and the existing member uploads. Shop, trips and the old payment screens are no longer part of the site navigation; their old page URLs return to the core pages. Existing stored records are not deleted by the simplification.

### Members and RSVPs

Members sign in to their own 2027 account. Signup uses the society roster: one account can claim each roster entry. A server-side unique constraint allows one RSVP per event and account, and the RSVP RPC updates that record. The browser loads the current event and response before editing, blocks repeat clicks while opening/saving, and keeps form values after a failed save. No editable name field is used to identify the member at RSVP time.

Once tee times are published, member RSVP buttons become **Tee times** and withdrawals go through the committee. The existing six-day change cutoff remains. A fixed roster prevents duplicate registration under the same roster entry, but selecting a name is not proof of a person's real-world identity; admins must resolve a wrongly claimed name.

### Admin

Choose the event, then use **Event details**, **RSVPs**, **Tee times**, **Scores** or **Members**. Event details keeps the essential fields visible and optional details collapsed. Course search still prepares GPS/Hole View automatically. Cancellation is available separately from ordinary editing; permanent deletion is not offered in the normal workflow.

The score grid accepts each player's **total Stableford points for 18 holes**. **Save draft** saves private work; **Complete round** publishes the completed round and updates the next handicaps. An incomplete score, invalid number, unresolved tied winner, missing starting handicap or incomplete earlier round blocks completion with an explanation. The established society convention remains: zero is recorded as DNP and excluded from the field average. Revisions reject conflicting saves by two admins. Correcting an earlier round rebuilds the subsequent published calculations.

### Leaderboard and private rounds

The season table shows all seven columns and sums each player's best five published scores. Four or fewer scores all count; six scores drop the lowest; seven scores drop the lowest two. Equal points use round wins, then equal rank. Tied round winners require organiser countback selection.

Rounds 6 and 7, their scores, wins and aggregate effects remain admin-only. The database returns only published rounds 1–5 to members and anonymous viewers. The member table uses blurred dummy marks, never hidden scores in CSS, HTML, data attributes or totals. The client also applies its current viewer limit and clears previously rendered scores during refresh and sign-out. Round 7 playing handicaps remain protected because they could expose round 6 adjustments.

### Hole View

Course Hole View is retained and can now be opened before the event day from Home or the event page. The existing course-layout RPC continues to enforce member/admin access and verified coordinate visibility. Mapping, GPS and camera implementation remain in the existing modules; GPS accuracy still needs a real on-course device check.

### Verification and deployment

Static HTML/CSS/JavaScript on the existing GitHub Pages repository, with the isolated 2027 Supabase backend. No build step or framework migration.

- `node tests/simple-scoring.mjs`: independent subset-enumeration checks for best-five totals, partial seasons, ties, DNP, privacy, malformed/duplicate data and handicap rules.
- `node tests/simple-site.cjs`: current mobile/desktop journeys with isolated API fixtures; all writes are mocked. Runs in the existing GitHub Actions browser environment.
- `node tests/course-mapping.mjs`, `node tests/course-scorecard.mjs`, `node tests/hole-setup.mjs`, `node tests/course-preparation.mjs`: retained mapping and course preparation checks.
- SQL regression files in `tests/` use transactions and roll back their fixtures. They check the real database rules when explicitly executed against the 2027 project.

On 18 October 2026, the mobile/desktop workflow and all listed Node checks passed at commit `8da0a149ccc3f0a5fad44255a4e6cef9bb6e605f`. The real 2027 database also passed `season-scoring.sql`, `member-rsvp.sql`, `published-rsvp.sql` and `member-tee-profiles.sql`, including rejection of a second account for the same roster member. All SQL fixtures rolled back; no production data or schema changes were needed.

The older large browser files are retained as historical test/fixture sources; their removed wizard/menu flows are not the current interface. The current workflow runs `simple-site.cjs` and the course logic checks.

---

## Implementation history

The notes below record earlier implementation decisions. Where an old screen or journey differs from the current workflow above, follow the current workflow.

# Barford Golf Society — 2027 starting point

This is an isolated replica of the public pages in `Highstreetwebco/barford-golf-society` at commit `551434d40e5bf5d052d6fe30bf9fcb9648fffdd7`.

Deploy only this repository's `main` branch to its existing GitHub Pages address:
https://highstreetwebco.github.io/barford-golf-society-2027-dev/

## Isolation

- Historical development-only restriction, superseded by Jack’s 2 November 2026 launch request: the production domain now belongs to this 2027 repository. Keep the 2026 website and backend intact at its GitHub Pages address.
- The only backend is Supabase project `xspzmthygrajzktydvvj`.
- Fresh `baseline_*` tables and `baseline-*` storage buckets keep this restart separate from the previous 2027 data. No live member, booking, score or gallery records were copied.
- Existing 2027 accounts and administrator permissions remain intact. Admin actions use Supabase authentication and database policies, not the live site's hard-coded password.
- WhatsApp delivery is not connected in this development site. It must not call the live notification endpoint.
- The complete previous version is preserved on branch `archive/before-live-replica-2026-09-26` at commit `74ee1760a06e54d198406ff125796151821f9730`.

## Development

Static HTML, CSS and JavaScript; no build step. Serve the repository with a static HTTP server. The Supabase SDK is vendored at version 2.116.0 from the previous 2027 build.

The live layout and existing navigation are the baseline. Changes here should follow Jack's next instructions rather than restore features from the retired app.

## Member experience

The 2027 member site uses one shared layout across Home, Events, Scores, World events, Shop, Gallery, About and Account. Organiser controls are shown only for the existing administrator role.

- Members sign up with name, email and password. Existing accounts continue to work. Phone is optional in Account and stays private to organisers.
- An event RSVP asks only Playing, Buggy and preferred tee time (First / Middle / End). Not playing hides the irrelevant options.
- The database enforces one RSVP per event and account. Re-submitting edits it; names are taken from the member profile. Different members may share a name.
- Event capacity and waiting-list promotion run in one database transaction. A withdrawal releases the space to the oldest waiting response. This guarantees one response per account, not one account per human across different email addresses.
- Tee groups are published atomically and validate every confirmed player exactly once, with at most four per group. Attendance or buggy changes flag published groups for organiser review.
- World-event interest is also one editable response per account. Shop reservations and photo uploads require sign-in.
- Shop reservations do not collect payment. Cancelling an undelivered order restores stock atomically.

The additive migration is `supabase/migrations/20260926131936_member_accounts.sql`. It was applied to the isolated 2027 project. It intentionally refuses to guess account ownership if anonymous baseline responses exist. The original baseline schema remains the initial migration source; apply the member migration afterwards on a new copy.

## Verification

`tests/baseline.cjs` runs in GitHub Actions with Playwright: real read-only development API page checks at 390 and 1365 pixels, and mocked HTTP account/RSVP/shop/admin journeys. No accounts, emails or bookings are created by browser verification.

`tests/member-rsvp.sql` verifies the actual database functions and permissions within a transaction, including synthetic account-profile creation, repeated submissions, editing, duplicate names, capacity, promotion, member identity, anonymous blocking, private contacts, trip responses and tee publication. It rolls back every test record.


## Member and event experience (September 2026)

The isolated 2027 site now uses the 48 public 2026 scoreboard names as the signup roster. One account can claim each name, with an explicit identity confirmation. This is a deterrent, not identity verification. Names are derived and protected server-side. Existing matching accounts keep their login; unmatched existing accounts must link a roster name before RSVPing. No live scores, mobile numbers or emails were imported.

Name/password login uses Supabase password authentication behind the `baseline-services` function. Internal random email aliases are not user-facing email inboxes. Name-only members need organiser-assisted password recovery. Never enable email confirmation for these aliases without replacing this auth design. Session persistence and token refresh are enabled.

Event pages support optional tee preference, private assigned buggy-partner phone access, atomic booking responsibility, directions, UTC-correct ICS calendars, and a forecast based on published tee time (otherwise the first tee). Buggy pairs are formed within published tee groups; odd buggy players need organiser attention. Changing attendance marks tee groups stale and hides pair contact until reviewed. Re-publishing preserves booking responsibility for unchanged pairs.

Course lookup uses the existing server-side GOOGLE_MAPS_API_KEY. Only place IDs are retained from Google; photos, descriptions and review excerpts are fetched for display with attribution and are not cached. Organiser-entered course details/photos can override defaults. YouTube search tries YOUTUBE_API_KEY or the Google key; automatic search requires YouTube Data API access and quota. Manual YouTube URLs remain supported.

Open-Meteo provides hourly forecasts within 16 days. The scheduled GitHub Action refreshes upcoming events daily; page views refresh stale data as fallback. Courses need coordinates or a valid Google course match. Forecast probabilities are hourly, not aggregated round probabilities. Dates and calendars use Europe/London; duration is an organiser-set estimate. GitHub scheduled jobs can be delayed or disabled after repository inactivity.

Verification: `tests/member-rsvp.sql` and `tests/member-experience.sql` use synthetic accounts and roll back. `tests/baseline.cjs` checks desktop/mobile layout and member/organiser flows without sending messages or creating real registrations.


## Account administration

`admin.html` opens on Accounts and requires a current administrator profile. Admins can search every account, edit usernames/mobile numbers/handicaps, grant or revoke admin access, and set a replacement password for a verified member. Member edits use protected RPCs; role changes are audited. Self-demotion and removal of the final administrator are blocked server-side, including older profile-update routes. Password resets run only in the Edge Function after validating the caller and current admin role. Existing passwords cannot be viewed.

The six pre-reset accounts were removed on 26 September 2026 at the owner's request and replaced with one newly created administrator. Old sessions and refresh tokens were removed. The member roster remains available for fresh registration. Credentials and mobile numbers are not committed to this repository.

### 2027 league scoring

Admin has **Starting handicaps**, **Enter scores**, and **Setup next round score cards** tabs. In Event details assign each event a unique round 1–7; leave social events unassigned. Set registered members’ starting handicaps, enter/paste points for confirmed players, save private drafts, resolve tied winners after countback, then publish the complete round atomically. Enter advances down the points column. A zero means DNP: select DNP (spreadsheet paste converts zero automatically). Additional registered participants can be added to the score sheet.

Scoring follows the active `calculateHandicaps` implementation in the read-only live 2026 `scores.html` (commit `551434d40e5bf5d052d6fe30bf9fcb9648fffdd7`), not its unused `stablefordAdj` helper: at least four played scores; trim one high and low when there are more than four; integer average; difference bands, handicap multipliers, JavaScript-compatible rounding, adjustment clamped −3/+2 and handicap floored at zero. DNP entries are deliberately excluded from the field average (fixing the live zero-entry bug). Best five scores count, ties use wins; still-equal players share rank. No additional winner cut or maximum resulting handicap is imposed. The page explains the exact bands.

`profiles.handicap` is exclusively the **starting** handicap. All next-round values are computed server-side in private tables. Editing a starting handicap through either admin route or correcting an earlier score rebuilds subsequent published rounds. Publish earlier rounds first. The scorecard list shows provisional warnings until preceding rounds are published and all required starting handicaps exist. It excludes declined/waiting players, orders by published tee group then name, and offers print/CSV.

Raw scores/drafts/audit live in `baseline_private`; the member/anonymous board RPC returns only published rounds 1–5. The frontend aggregates only these visible results, so R6/R7 cannot leak through totals, rank, wins or next handicaps. Admin gets all seven. Decorative blur contains dummy dots, never real hidden values. Legacy baseline player/score table privileges have been revoked. Changes use a season revision to reject stale concurrent edits; event round reassignment/deletion is blocked once a draft exists. Database tests in `tests/season-scoring.sql` run in a rollback transaction. No live 2026 database writes are part of this system.

### Guided round entry and member tee groups

**Input scores for round N** in the Enter scores tab opens one confirmed participant at a time. Each confirmation saves a private draft before advancing. Save & close keeps progress; reopening resumes at the first pending entry. A failed save stays on the same member. Zero is treated as DNP. Adjustment previews explicitly remain provisional until all played scores are known; before four scores there is no valid field average. The final **Complete round** dialog shows all calculated changes, ties and automatic DNPs for registered non-participants, then calls the existing atomic publish endpoint. The spreadsheet/grid method remains available for bulk corrections.

The homepage shows a signed-in member’s published tee group with time, authoritative profile names, round handicaps and optional portraits. View all tee groups expands the whole event; the dedicated event page shows the same information. Stale or cancelled tee groups are suppressed. Round 7 handicaps are withheld from members because they would reveal hidden round 6 adjustments; admins can see them. Missing earlier results are explicitly provisional.

Profile photos can be selected during signup or added/replaced/removed in My account. JPEG/PNG/WebP up to 10 MB are decoded and centre-cropped to a 640px JPEG, which removes EXIF metadata. HEIC needs conversion. The private `baseline-profile-images` bucket accepts only JPEG/PNG/WebP up to 2 MB, with active-member reads and owner-folder writes/deletes. Paths are validated against ownership and actual Storage objects. Portraits use expiring signed URLs, initials when unavailable, and an enlargement dialog. A failed signup photo upload leaves the created account usable and offers account-page retry. Tests cover private storage policies, path ownership, blocked anonymous/disabled access, member-safe handicaps, guided resume/retry/completion and the photo/tee-group UI.


## Committee operations update

Admin → Manual handicap adjustments sets an individual handicap from an unpublished round (2–7), with a required committee reason and audit history. It leaves earlier results and starting handicaps unchanged; normal automatic adjustments resume from the chosen value. Stale season revisions are rejected. Starting handicaps are capped at 36; later calculated values may exceed it. Protected R6/R7 result and R7 handicap visibility is retained.

Event details now select league, pairs/invitational or social format, with arrival/refreshment times, inclusions, parking, practice and layout notes, notices and format rules. No nearest-pin or longest-drive hole fields were added. Member/guest/course-member prices and booking/payment/cancellation dates are separate. Prices and bank details are intentionally not seeded from historic chat messages. Enter the 2027 values in Event details and Payments → Annual fee, bank details & guest policy.

Payments are private bank-transfer records, not card checkout. Confirmed RSVPs get charges when their category price is configured. Waiting-list entries are not charged until promoted. Members can report a transfer; admins verify actual receipts, apply individual prices, review withdrawals and record credits. Cancelling a booking never silently refunds money or deletes the ledger. Existing charges retain agreed prices. Annual fee creation excludes guest accounts. Privileged changes are audited and payment edits use optimistic revisions.

Guest invitations use a private link for one event RSVP without an account. The invitation does not hold a place; the guest’s handicap remains subject to committee review. Missing-name enquiries can be approved into the signup roster. Pairs events distinguish playing partners from buggy partners, require acceptance, and keep confirmed playing pairs in a single tee group. Social events omit golf questions.

Tee publication includes a review of affected players, timestamp/version, private member change notices and a copyable WhatsApp update (no messages are sent automatically). Buggy reservation confirmation is distinct from booking responsibility. If pairings change, the previous booking owner receives a reminder to check any reservation with the course. Expanding capacity promotes the waiting list; changed event timings invalidate the old tee sheet pending review.

The event checklist assigns owners to seven preparation tasks. Expenses and prize stock have private organiser records. Setup instructions for iPhone/Android appear on the entry/account pages. Operational data uses guarded RPCs and private-schema tables with RLS and no direct member grants.

Database coverage: `tests/committee-operations.sql` and existing scoring/member tests use rolled-back fixtures. Browser coverage includes social RSVP, pending transfer/receipt, future-round overrides, and event checklist at mobile and desktop widths. Browser fixtures never create real members or financial entries.

## Guest invitations without an account

**Invite a guest** sits below RSVP on Home and the event page. A member needs a confirmed place. Missing guest prices are clearly shown as to be confirmed; the inviting member must confirm any cost before payment. The generated message opens the phone’s share sheet so the member can choose an app and recipient, with WhatsApp/copy fallbacks. Nothing is sent automatically. Each invitation is for one person; the token stays in the URL fragment and must be kept private. For golf events, up to three active invitations/guest places fit alongside a host in a fourball. Social events use the event’s overall capacity instead.

`guest.html` is a standalone page that collects full name, contact number, optional email, current handicap, confirmation of the inviting member, optional portrait and cancellation acceptance. No login or synthetic Auth account is created. Guest identity uses an invite-only roster record and the existing member-ID RSVP path. Contact data stays private; signed-in members see the guest’s name, portrait and approved playing handicap on the tee sheet. A guest cannot change the host assigned to the invitation.

`guest-rsvp` is a separate Edge Function authenticated by the project key and unguessable invitation capability. It calls `baseline_guest_rsvp`, a service-role-only RPC. Neither it nor `guest.html` grants preview access to the rest of the site; Coming soon remains enforced everywhere else. Rate limits apply per hashed network address, invitation and photo changes. Portraits are resized to 640px, validated at the endpoint, kept in private Storage and served using short-lived signed URLs. Guest links never appear in calendar exports.

The original invitation reopens the same RSVP with optimistic revision checks. Online guest edits, withdrawals and photo changes close at **00:00 Europe/London on event date minus 10 days**. Initial RSVPs also respect the event’s earlier booking deadline. Admin → Responses → Edit response opens a guest editor for contact details, handicap, status and photo; it remains available after the cutoff through an independently authenticated RPC. Capacity, waiting-list order and automatic promotion are shared with member bookings. An RSVP confirmation distinguishes waiting, confirmed and withdrawn states; only confirmed guests get Google, Apple/ICS and Outlook calendar options. Calendar exports use the guest’s published tee time in UK time, or an explicitly all-day entry while the individual time is unassigned.

The tee generator treats host/guest links and confirmed playing pairs as indivisible. Missing hosts and components larger than four require admin resolution. Publication independently rejects split hosts/guests in Postgres. Guest changes affecting a published group mark it for review; a contact-only edit does not hide valid tee times. The guest price is snapshotted at booking, including a to-be-confirmed price; later advertised changes never silently assign a fee to a guest who booked without a confirmed price. These account-free guests do not have member payment-login accounts; organisers coordinate payment with the inviting member.

Validation: `tests/guest-rsvp.sql` checks isolated database authorization, no-Auth booking, price/terms/revision guards, contact privacy, portraits, capacity, withdrawals, pairing, deadline and admin overrides. `tests/guest-rsvp.mjs` covers grouping, calendar time zones and the capability endpoint. `tests/guest-site.cjs` runs phone/desktop sharing, guest RSVP, photo, same-link editing, cutoff, calendar and admin flows in GitHub Actions. Existing account, manual booking and portrait checks continue to pass.

## Event-day hole view

Admin → Event details uses one form: event type, a required Round 1–7 selector for league events, event/course details, refreshments time, first tee time and visible member/guest prices. Arrival time, parking, textual course layout, playing rules and duplicate price description have been removed and are cleared when an event is saved. Course search fills address, website and phone. Cover photos are uploaded from the device; map coordinates remain hidden.

**Find course and GPS hole layout** searches for the venue. Selecting a result immediately starts shared GPS preparation for every new event; opening an event without valid GPS or switching back from a social event also starts preparation. A single scorecard or unique Yellow / Yellow (men) scorecard at a single-course venue is selected automatically. Missing scorecards do not block GPS: the service can independently verify 18 unique numbered map routes, one matching course boundary, and a unique green footprint for every route and 18 distinct mapped route starts. Such GPS-only layouts retain available map-sourced pars, leave published yardage and stroke index blank and record that their order comes from numbered map routes. Available scorecards must match those routes; conflicting known facts are never silently discarded. Multiple mapped courses require a course-layout choice, after which preparation resumes automatically. Nine-hole layouts cannot masquerade as 18 distinct holes. Provider lookups are bounded and use fixed hosts.

A failed or incomplete lookup returns `unavailable` with no draft, creates no layout and leaves GPS unattached. Complete maps can be previewed before any event exists. **Save event** waits for any in-progress GPS lookup, saves the verified positions and attaches them in the same user action. There is no separate map-confirmation step. Previewing is optional. Provenance records `confirmation_method: event_save`; the legacy `reviewed` flag is set only for a complete, validated map accepted through event saving. A failed GPS write blocks the event write; retrying a failed event write reuses the already-saved map. An unavailable course can still be saved as an event without GPS. Existing event-linked maps are loaded only when their validation and completeness can be verified; a read failure blocks saving rather than silently deleting that link.

OSM-derived green points are matched to green areas. A route start is a reference position, not a surveyed or colour-verified tee marker. Separate tee polygons are recorded when uniquely available; absent or overlapping tee polygons do not block live player-to-green distances. Validation records actual tee-area coverage separately from the 18 route starts. The UI makes that limit explicit. Scorecard tee selection controls published scorecard facts; actual live yardages use the player's current position. Green centres derive from mapped green geometry; optional front/back distances are never invented. Source attribution and per-hole map-feature evidence are retained.

On the event date in Europe/London, signed-in members see **View hole** on the homepage. The dialog shows holes 1–18; only reviewed holes with tee and green coordinates open. **Use my GPS** requests browser location permission. Live yardages require a recent fix (15 seconds), accuracy of 35 metres or better, and a position near the saved course. Otherwise yardages are explicitly labelled as measured from the mapped tee. GPS stops when the dialog closes or the page is hidden; no location is saved or sent to Supabase. Satellite imagery requires connectivity and the existing Google Maps browser key to remain authorised for this origin.

Layouts and audit data live in `baseline_private`. `baseline_course_layout` checks active membership/admin access, redacts unreviewed coordinates for members, and uses revisions to reject concurrent layout saves. SQL checks in `tests/course-layout.sql` roll back all fixtures. `tests/hole-view.cjs` exercises event-day gating, map/GPS states and mobile presentation with mocked location and Google Maps; a physical on-course phone check is still needed to assess real GPS accuracy.

Course preparation coverage: `tests/course-mapping.mjs` checks boundary selection, duplicate hole numbers, partial coverage, scorecard alignment, response bounds and provider fallback. `tests/course-preparation.sql` verifies metadata, matching, member redaction/provenance and Storage policies in a rolled-back transaction. `tests/event-setup.cjs` checks practical event fields, photo validation/retry, stale course responses, legacy restoration, partial mapping and scorecard changes. Public map attribution is retained for OSM-derived geometry.

The October 2026 mapping repair supports OSM multipolygon course boundaries, including reversed/unordered outer sections and inner exclusions. Incomplete or ambiguous boundaries remain rejected. When Overpass is unavailable, the official OSM fallback discovers the nearby boundary and requests its exact extent instead of exporting a town-wide area that can exceed the 50,000-node limit. Provider responses must pass geometry validation before cancelling the fallback. The shared lookup deadline is 35 seconds, including response downloads. A captured Leamington & County yellow-tee fixture checks all 18 routes, physical tee/green anchors and scorecard ordering; all boundary, route, and green checks remain required before automatic GPS setup can be saved with the event.

## Simpler member event journey

Home puts RSVP and guest invitations next to the event. RSVP opens a small dialog on the same page, using the existing one-account-per-event booking procedure, cancellation terms and waiting list. The member can change or withdraw the same booking. Links to a different round use `index.html?event=ID#rsvp` and must match that event, without silently substituting the next round.

Events are full-card links with the uploaded course photograph behind a short date, tee-time, price and availability summary. The dedicated event page holds the full information in expandable sections, including travel, calendar, course preview, weather, players and private booking details. Legacy event RSVP links continue to work.

The Welcombe regression fixture reproduces the unconfirmed tee areas at holes 4, 12 and 18. All 18 greens and numbered routes remain verified; those three starts retain explicit route-reference provenance. Missing or ambiguous greens still reject the layout.

Admin previews also expose camera direction guidance for mapped greens; camera, location and compass permissions still require the user to press Start. GPS-only pars are retained from numbered map routes and labelled as map data.

Course preparation requests declare map_format 3. Older organiser pages receive an update-required message before provider lookups rather than an incompatible map. The service worker fetches same-site navigation and scripts with no-store so revisiting the page does not reuse cached HTML or JavaScript. Existing open forms are never automatically reloaded.

Once golf tee times have been published, member RSVP actions become Tee times and the homepage shows the committee withdrawal notice above the published group. Guest invitation creation is hidden there. The shared RSVP dialog also blocks old links; the RSVP database function enforces the lock while retaining committee/admin changes. Social events and the existing six-day change cutoff retain their prior behaviour.

## Admin-managed event bookings

In Admin → RSVPs, Add member records a booking for any existing roster member, including people without a 2027 login. The normal capacity, waiting list, tee review and duplicate checks apply. Organisers can edit or withdraw the same response.

Offline attendees use a roster identity, never a fabricated authentication account. Registration links their existing RSVP, queue position, tee assignment and scores. Offline starting handicaps can be entered under Members. Account-based online payments and buggy booking ownership become available after registration; their attendance and buggy request are visible immediately.

Run `tests/admin-member-bookings.sql` transactionally to verify booking, capacity, registration inheritance, scoring and authorization. All test records roll back. Browser checks are in the existing GitHub Actions workflow.
