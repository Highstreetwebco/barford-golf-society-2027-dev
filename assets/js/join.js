const b = await window.barfordReady;
const form = document.getElementById("joinForm");
form.onsubmit = (event) => {
  event.preventDefault();
  b.submit(form, async () => {
    const f = Object.fromEntries(new FormData(form));
    const { error } = await b.client.from("signups").insert(f);
    if (error) throw error;
    form.innerHTML =
      '<h3>Your request has been received.</h3><p>An organiser will review it and contact you. Once approved, your name will appear on the signup list.</p><a class="button secondary" href="signup.html">Back to account creation</a>';
  });
};
