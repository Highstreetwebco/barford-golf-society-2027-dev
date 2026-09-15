# Stripe Checkout activation

The live site has Pay now actions on booked events and payment receipts. Online
checkout is deliberately disabled (`stripeCheckoutEnabled: false`). No Stripe
account or checkout backend is connected yet; clicking explains that payment is
not available and offers existing committee instructions.

The frontend is prepared to invoke the authenticated Supabase Edge Function
`create-event-checkout`, sending only `{ "event_id": "..." }`. Its success response
must be `{ "url": "https://checkout.stripe.com/..." }`.

Before enabling checkout:

1. Create the society's Stripe account and complete its activation requirements.
2. Implement and deploy `create-event-checkout`. Verify the Supabase JWT and load
   the member's current RSVP and event server-side. Reject reserves, cancelled or
   non-playing bookings, settled fees, unknown prices and free events. Determine
   GBP pence from the stored booking category and authoritative event price.
   Never trust an amount, member ID or payment status sent by the browser.
3. Store a payment attempt before creating a Stripe Checkout Session. Use stable
   idempotency keys and reuse an existing open session so repeat taps cannot create
   multiple payable checkouts. Snapshot the booking/rate/amount and prevent price
   category changes during an active checkout (or expire that checkout).
4. Keep Stripe secret keys and webhook signing secrets in Supabase secrets only.
   Add a signature-verified webhook that verifies paid status, currency, amount and
   booking ownership against the stored attempt. Process webhook events once,
   persist the Stripe references, and update `rsvps.payment_status` through the
   trusted backend only. Handle expired sessions, refunds and late payments after
   cancellation explicitly. A success URL must never mark a booking paid.
5. Return to `payments.html?event=<event UUID>` after success or cancellation.
   Display the database-confirmed status; allow refresh while webhook confirmation
   is pending. Use a fixed allowlisted site URL for redirects.
6. Test in Stripe test mode: paid/free/course-member prices, double taps, webhook
   replays, failed authentication, changed prices, cancelled bookings, refunds and
   dropped connections. Guest checkout needs a separately verified guest booking
   flow; never identify a payable booking using a name alone.
7. Only after those checks, set `stripeCheckoutEnabled: true`, build and publish.

This is frontend preparation, not a completed or tested Stripe integration.
References: https://docs.stripe.com/payments/checkout/how-checkout-works
and https://docs.stripe.com/checkout/fulfillment
