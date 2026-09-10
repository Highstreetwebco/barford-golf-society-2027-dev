# Performance pass — 10 September 2026

The approved clubhouse design, member features, access controls and scorecard persistence remain in place.

## Download measurements

These are uncompressed file sizes and declared requests, not measured page-load timings. The comparison excludes the account SDK on both sides (previously external, now served locally), images and optional dynamic scripts. The results bundle now includes its two module dependencies; the previous declared-script total did not include those later requests.

| Page | CSS requests before → after | CSS bytes before → after | App JS bytes before → after |
|---|---:|---:|---:|
| index | 6 → 3 | 165,169 → 156,537 | 55,772 → 44,478 |
| events | 6 → 3 | 114,489 → 108,234 | 40,604 → 32,418 |
| account | 6 → 3 | 165,169 → 156,537 | 69,947 → 52,425 |
| scores | 7 → 3 | 170,018 → 156,175 | 61,069 → 49,711 |
| scoring | 8 → 3 | 104,638 → 101,038 | 55,642 → 43,545 |
| gallery | 6 → 3 | 105,098 → 100,433 | 43,968 → 34,420 |
| hole-view | 4 → 3 | 46,098 → 43,388 | 30,311 → 18,513 |

- Homepage photograph: 582,094 bytes previously; responsive alternatives of 66,824 bytes (640 px) and 288,054 bytes (1280 px), reductions of 88.5% and 50.5%. The browser selects based on displayed width and pixel density.
- 24 archive gallery previews total 671,052 bytes. Full-size originals remain available in the lightbox. Existing legacy-03 and legacy-05 files are truncated WebP files in the repository; they retain their existing original URL because no valid preview could be decoded. No originals were overwritten.
- Bundled account SDK: Supabase JavaScript 2.116.0, pinned with the lockfile, served from the site rather than the mutable external @2 URL. SDK requests are no longer dependent on an additional CDN connection. Notices are in third-party-notices.txt.

## Member actions

- Dashboard supplies its freshly read event and own RSVP to the event loader. One RLS-protected join replaces two scorecard lookup requests. Unpublished tee groups are not requested. The common unpublished-groups path falls from 9 table/RPC reads to 5 (published groups: 6). Optional theme/promotion requests are excluded.
- Booking changes still recheck the server lock and reread the stored RSVP/payment status before showing confirmation.
- Account and theme share the initial profile lookup. Repeated avatar signing is deduplicated; optional photos cannot delay the account form or sign-out.
- Leaderboard numbers render before photographs, using one background batch to sign private images. Concurrent results requests share their work and results caches are scoped to the member.
- Public archive gallery previews appear before account and recent-photo requests finish. An open lightbox retains its photo when recent images arrive.
- Course view restores a matching saved snapshot before querying the event, performs one background refresh and retains the saved layout if any refresh query fails. Administrator setup loads only for an authorised administrator.

## Caching and updates

- Content-hashed, minified CSS/JS assets preserve stylesheet order and inline overrides. Shared styles are reused across pages. Scores modules are bundled.
- Cached static pages and assets return immediately without repeated no-store downloads. API, auth, storage and Maps traffic remain outside the service worker cache. There is no hover/touch prefetch download burst.
- Offline core installation has three concurrent downloads and must complete before activation. Its name is derived from build content so a failed new installation cannot delete an active release cache. Query strings still drive the round/event while static page shells match by path.
- A new worker never reloads the current page. It takes over future navigation; one previous cache is retained for open pages and offline fallbacks. Keep previously published hashed assets on the server when rebuilding.
- Service worker registration follows page load. Background account/event data is refreshed normally; static caching does not make cached booking decisions authoritative.

## Verification

30 automated checks cover existing booking/payment states, sign-out recovery, scoring ownership, save acknowledgement, offline score entry, queued submission, refusal handling, cache installation failures, quotas, scope boundaries, query-driven offline navigation, previous-cache retention, reduced event reads, asynchronous photo loading, course snapshot preservation and offline dependency completeness. All 15 pages retain their CSS cascade order, inline styles and element IDs. The build is reproducible. No live bookings, scores or member records were changed for testing. Signed-in behaviour is verified through deterministic harnesses rather than a member transaction.

Build: `npm ci && npm run build`; verify: `npm test`. Edit the original `assets/js` and `assets/css` files; generated asset references in HTML are restored through the manifest and data-css-sources metadata on the next build. Commit source, generated assets, manifest and sw.js together. Preserve old published hashed assets for clients still running the preceding release.

Implementation references: [Supabase referenced table queries](https://supabase.com/docs/reference/javascript/select), [batch private image URLs](https://supabase.com/docs/reference/javascript/file-buckets-createsignedurls), [esbuild minification](https://esbuild.github.io/api/#minify).
