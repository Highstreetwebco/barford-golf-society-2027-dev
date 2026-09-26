# Barford Golf Society — 2027 starting point

This is an isolated replica of the public pages in `Highstreetwebco/barford-golf-society` at commit `551434d40e5bf5d052d6fe30bf9fcb9648fffdd7`.

Deploy only this repository's `main` branch to its existing GitHub Pages address:
https://highstreetwebco.github.io/barford-golf-society-2027-dev/

## Isolation

- Never add `CNAME`, point this repository at `barfordgolf.co.uk`, or write to the live repository.
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
