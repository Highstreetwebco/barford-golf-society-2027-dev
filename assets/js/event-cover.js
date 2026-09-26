// Event covers are decoded and resized locally before an organiser uploads them.
export async function prepareCover(file) {
  if (!file) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Choose a JPEG, PNG or WebP photo. Export HEIC photos as JPEG first.");
  if (file.size > 10 * 1024 * 1024)
    throw new Error("Choose a photo smaller than 10 MB.");
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error("This photo could not be opened. Choose another image."); }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 50000000)
      throw new Error("This photo is too large. Choose a smaller image.");
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      value => value ? resolve(value) : reject(new Error("Could not prepare this photo.")),
      "image/jpeg", 0.86,
    ));
    if (blob.size > 2 * 1024 * 1024)
      throw new Error("This photo is still too large. Please choose a smaller image.");
    return blob;
  } finally { bitmap.close(); }
}

export function mountCoverUpload(form, b) {
  const input = form.querySelector("#eventCoverFile"),
    preview = form.querySelector("#eventCoverPreview"),
    status = form.querySelector("#eventCoverStatus"),
    remove = form.querySelector("#removeEventCover");
  let version = 0, blob = null, pending = null, error = null,
    currentUrl = null, objectUrl = null, uploaded = null, uploading = false;
  function revoke() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  function show(url) {
    if (url) preview.src = url;
    else preview.removeAttribute("src");
    preview.hidden = !url;
    remove.hidden = !url && !error;
  }
  input.addEventListener("change", () => {
    const token = ++version, file = input.files[0];
    error = null; uploaded = null; blob = null; revoke();
    show(currentUrl);
    status.textContent = file ? "Preparing cover photo…" : "";
    pending = prepareCover(file).then(value => {
      if (version !== token) return;
      blob = value;
      if (value) { objectUrl = URL.createObjectURL(value); show(objectUrl); }
      status.textContent = value ? "Photo ready. Save the event to upload it." : "";
    }).catch(err => {
      if (version !== token) return;
      error = err; status.textContent = err.message; remove.hidden = false;
    });
  });
  remove.addEventListener("click", () => {
    version++; revoke(); blob = pending = uploaded = error = null;
    currentUrl = null; input.value = ""; form.elements.cover_url.value = "";
    show(null); status.textContent = "Cover removed. Save the event to confirm.";
  });
  return {
    reset(event) {
      version++; revoke(); blob = pending = uploaded = error = null;
      currentUrl = event?.cover_url || null; input.value = "";
      form.elements.cover_url.value = currentUrl || "";
      status.textContent = ""; show(currentUrl);
    },
    async saveUrl() {
      const token = version;
      if (pending) await pending;
      if (token !== version) throw new Error("The cover photo changed. Please save again.");
      if (error) throw error;
      if (!blob) return currentUrl;
      if (uploaded) return uploaded.url;
      if (uploading) throw new Error("The cover photo is still uploading.");
      uploading = true; input.disabled = remove.disabled = true;
      status.textContent = "Uploading cover photo…";
      try {
        const bucket = b.raw.storage.from("baseline-event-covers");
        const path = `${b.state.user.id}/${crypto.randomUUID()}.jpg`;
        const result = await bucket.upload(path, blob, {
          contentType: "image/jpeg", cacheControl: "3600", upsert: false,
        });
        if (result.error) throw result.error;
        const url = bucket.getPublicUrl(path).data.publicUrl;
        if (token !== version) throw new Error("The event changed while the photo uploaded. Please save again.");
        uploaded = { path, url };
        status.textContent = "Photo uploaded. Saving event…";
        return url;
      } catch (err) {
        status.textContent = err.message || "The photo could not be uploaded. Please try again.";
        throw err;
      } finally { uploading = false; input.disabled = remove.disabled = false; }
    },
  };
}
