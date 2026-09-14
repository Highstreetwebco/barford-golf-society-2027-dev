(() => {
  'use strict';
  const F = window.BarfordMemberFlow, client = window.BarfordSupabase;
  if (!F || !client) return;
  const key = id => `barford-guest-booking-v1:${id}`;
  const memory = new Map();
  function token(id, create = false) {
    let value = memory.get(id);
    try { value = localStorage.getItem(key(id)) || value; } catch {}
    if (!value && create) {
      value = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
      memory.set(id, value);
      try { localStorage.setItem(key(id), value); } catch {}
    }
    return value || null;
  }
  const state = id => F.request(client.rpc('get_guest_event_state', {p_event_id:id, p_token:token(id)}));
  function render(host, event, info) {
    const own = info.booking, price = event.guest_price ?? event.price;
    const closed = event.status !== 'scheduled' || event.event_date < F.today() || info.locked || event.guests_allowed === false;
    const full = info.available === 0 || info.guest_available === 0;
    host.innerHTML = `<article class="simple-card"><p class="eyebrow">Guest event</p><h1>${F.esc(event.name)}</h1><p>${F.esc(event.venue)}</p><p>${F.esc(F.date(event.event_date))}</p><p>Guest price: <strong>${F.esc(F.money(price))}</strong></p><p>${F.esc(info.playing_count)}${info.capacity == null ? '' : ` of ${F.esc(info.capacity)}`} places booked</p>
      ${own ? `<section role="status"><h2>${F.esc(own.guest_name)} (guest)</h2><p>${own.status === 'playing' ? 'You’re playing this event.' : own.status === 'reserve' ? 'You’re on the reserve list.' : 'Your booking has been cancelled.'}</p>${own.status === 'playing' ? `<p>${F.esc(own.payment_status === 'paid' ? 'Paid' : own.payment_status === 'waived' || Number(own.amount_due) === 0 && own.amount_due != null ? 'No payment needed' : own.amount_due == null ? 'Price to be confirmed' : `${F.money(own.amount_due)} outstanding`)}</p>` : ''}<p>Your booking is saved. Return using this browser to check it, or contact the committee if you need a change.</p></section>` : closed ? `<p>${event.status === 'cancelled' ? 'This event has been cancelled.' : event.guests_allowed === false ? 'This event is for members only.' : 'Guest RSVPs are closed for this event.'}</p>` : `<p>RSVP with your name. You don’t need an account.</p><button id="guestRsvp" class="button button-primary" type="button">${full ? 'RSVP · Join reserve list' : 'RSVP'}</button>`}
      <div class="simple-actions"><button id="guestRefresh" class="button button-outline" type="button">Refresh booking</button><button id="guestContact" class="button button-outline" type="button">Contact the committee</button></div></article>`;
    host.querySelector('#guestRsvp')?.addEventListener('click', () => book(event, full));
    host.querySelector('#guestRefresh').onclick = () => window.dispatchEvent(new CustomEvent('barford-booking-changed'));
    host.querySelector('#guestContact').onclick = () => F.contact(event);
  }
  function book(event, full) {
    const d = F.dialog('RSVP as a guest', `<p>${F.esc(event.name)} · ${F.esc(F.date(event.event_date))}</p><form id="guestBookingForm"><label for="guestFullName">Your full name</label><input id="guestFullName" name="name" autocomplete="name" required minlength="2" maxlength="100"><p>Your name will appear as <strong id="guestNamePreview">Your name (guest)</strong>.</p><label><input type="checkbox" name="buggy"> Request a buggy</label><p>${full ? 'The event is full. Your RSVP will join the reserve list.' : `Guest price: ${F.esc(F.money(event.guest_price ?? event.price))}`}</p><button class="button button-primary full-button" type="submit">Confirm RSVP</button><p class="form-status" role="status"></p></form>`);
    const input = d.querySelector('#guestFullName');
    input.oninput = () => { d.querySelector('#guestNamePreview').textContent = `${input.value.trim() || 'Your name'} (guest)`; };
    d.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const button = d.querySelector('[type="submit"]'), status = d.querySelector('.form-status');
      const name = input.value.trim().replace(/\s+/g, ' ');
      if (name.length < 2) { status.textContent = 'Please enter your full name.'; input.focus(); return; }
      button.disabled = true; status.textContent = 'Saving your RSVP…';
      try {
        const booking = await F.request(client.rpc('create_guest_event_rsvp', {p_event_id:event.id, p_name:name, p_token:token(event.id, true), p_buggy_requested:d.querySelector('[name="buggy"]').checked}));
        if (!booking || !['playing','reserve'].includes(booking.status)) throw new Error('We couldn’t confirm your RSVP. Refresh your booking before trying again.');
        d.close(); window.dispatchEvent(new CustomEvent('barford-booking-changed'));
        F.dialog(booking.status === 'reserve' ? 'You’re on the reserve list' : 'Your RSVP is confirmed', `<p><strong>${F.esc(booking.guest_name)} (guest)</strong></p><p>${F.esc(event.name)}</p><p>${booking.status === 'reserve' ? 'Check your booking here for updates.' : 'You’re registered on the playing list.'}</p><a class="button button-primary" href="${F.eventUrl(event.id)}">View my booking</a>`);
      } catch (error) { status.textContent = error.message || 'Your RSVP could not be saved. Please try again.'; button.disabled = false; }
    };
    input.focus();
  }
  window.BarfordGuestEvents = {state, render};
})();
