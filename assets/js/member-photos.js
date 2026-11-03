import { preparePhoto, photoPickerHTML, wirePhotoPicker } from "./photo-input.js?v=2027-guest-rsvp-1";
export { preparePhoto, photoPickerHTML, wirePhotoPicker };
const b = await window.barfordReady;
const bucket = b.raw.storage.from("baseline-profile-images");
export async function savePhoto(blob, userId, previous = null) {
  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  const upload = await bucket.upload(path, blob, {
    contentType: "image/jpeg",
    cacheControl: "3600",
    upsert: false,
  });
  if (upload.error) throw upload.error;
  const result = await b.raw
    .from("profiles")
    .update({ baseline_avatar_path: path })
    .eq("id", userId)
    .select("id")
    .single();
  if (result.error) {
    await bucket.remove([path]);
    throw result.error;
  }
  if (previous) await bucket.remove([previous]);
  return path;
}
const signedPhotos = new Map();
export async function photoUrls(paths) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  const missing = unique.filter(
    (path) =>
      !signedPhotos.has(path) || signedPhotos.get(path).expires < Date.now(),
  );
  if (missing.length) {
    const { data } = await bucket.createSignedUrls(missing, 3600);
    for (const x of data || [])
      if (x.signedUrl)
        signedPhotos.set(x.path, {
          url: x.signedUrl,
          expires: Date.now() + 3300000,
        });
  }
  return Object.fromEntries(
    unique
      .filter((path) => signedPhotos.has(path))
      .map((path) => [path, signedPhotos.get(path).url]),
  );
}
export async function mountPhotoEditor(area) {
  const path = b.state.profile?.baseline_avatar_path,
    urls = await photoUrls([path]);
  area.innerHTML = `<form class="form-stack"><h2>Your profile photo</h2>${urls[path] ? `<img class="photo-preview" src="${b.escape(urls[path])}" alt="Your current profile photo">` : ""}${photoPickerHTML()}<div class="actions"><button>Save photo</button>${path ? '<button id="removePhoto" type="button" class="secondary">Remove photo</button>' : ""}</div><p class="form-status" role="status"></p></form>`;
  const selected = wirePhotoPicker(area),
    form = area.querySelector("form");
  form.onsubmit = (ev) => {
    ev.preventDefault();
    b.submit(form, async () => {
      const blob = await selected();
      if (!blob) throw new Error("Choose a photo first.");
      await savePhoto(blob, b.state.user.id, path);
      await b.refresh();
      await mountPhotoEditor(area);
      b.toast("Profile photo saved.");
    });
  };
  area.querySelector("#removePhoto")?.addEventListener("click", () =>
    b.submit(form, async () => {
      const r = await b.raw
        .from("profiles")
        .update({ baseline_avatar_path: null })
        .eq("id", b.state.user.id)
        .select("id")
        .single();
      if (r.error) throw r.error;
      await bucket.remove([path]);
      await b.refresh();
      await mountPhotoEditor(area);
      b.toast("Profile photo removed.");
    }),
  );
}
