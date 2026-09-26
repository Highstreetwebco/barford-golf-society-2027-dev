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
