const b = await window.barfordReady;
const bucket = b.raw.storage.from("baseline-profile-images");
export async function preparePhoto(file) {
  if (!file) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error(
      "Choose a JPEG, PNG or WebP photo. Export HEIC photos as JPEG first.",
    );
  if (file.size > 10 * 1024 * 1024)
    throw new Error("Choose a photo smaller than 10 MB.");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This photo could not be opened. Try another JPEG or PNG.");
  }
  try {
    if (bitmap.width * bitmap.height > 50000000)
      throw new Error("This photo is too large. Choose a smaller image.");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 640;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 640, 640);
    const side = Math.min(bitmap.width, bitmap.height);
    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      640,
      640,
    );
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Could not prepare this photo.")),
        "image/jpeg",
        0.85,
      ),
    );
  } finally {
    bitmap.close();
  }
}
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
export function photoPickerHTML() {
  return `<label for="profilePhoto">Profile photo (optional)</label><input id="profilePhoto" type="file" accept="image/jpeg,image/png,image/webp"><small>Choose a clear photo of yourself. A square preview is shown below. Visible to signed-in society members.</small><img id="profilePhotoPreview" class="photo-preview" alt="Your selected profile photo" hidden><p id="photoPickerStatus" role="status"></p>`;
}
export function wirePhotoPicker(area) {
  let blob = null,
    pending = null,
    url = null,
    error = null,
    version = 0;
  area.querySelector("#profilePhoto").onchange = () => {
    const n = ++version;
    error = null;
    blob = null;
    const file = area.querySelector("#profilePhoto").files[0],
      preview = area.querySelector("#profilePhotoPreview"),
      status = area.querySelector("#photoPickerStatus");
    if (url) {
      URL.revokeObjectURL(url);
      url = null;
    }
    preview.hidden = true;
    status.textContent = file ? "Preparing your photo…" : "";
    pending = preparePhoto(file)
      .then((value) => {
        if (n !== version) return;
        blob = value;
        if (blob) {
          url = URL.createObjectURL(blob);
          preview.src = url;
          preview.hidden = false;
        }
        status.textContent = "";
      })
      .catch((err) => {
        if (n !== version) return;
        error = err;
        status.textContent = err.message;
      });
  };
  return async () => {
    if (pending) await pending;
    if (error) throw error;
    return blob;
  };
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
