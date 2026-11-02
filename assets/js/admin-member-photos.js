import { preparePhoto, photoUrls } from "./member-photos.js?v=2027-results-1";

const b = await window.barfordReady, e = b.escape;
const bucket = b.raw.storage.from("baseline-profile-images");

export async function editMemberPhoto(person) {
  if (!b.state.adminAccess || !person?.member_id || person.disabled || document.getElementById("memberPhotoDialog")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "memberPhotoDialog";
  dialog.className = "account-editor";
  dialog.setAttribute("aria-labelledby", "memberPhotoTitle");
  dialog.innerHTML = `<form class="form-stack"><h2 id="memberPhotoTitle">Edit profile photo</h2><p><strong>${e(person.username)}</strong></p><div data-photo-fields></div><p class="form-status" role="status">Loading current photo…</p><div class="actions"><button type="submit" disabled>Save photo</button><button type="button" class="secondary" data-remove hidden>Remove photo</button><button type="button" class="secondary" data-close>Cancel</button></div></form>`;
  document.body.append(dialog);
  const form = dialog.querySelector("form"), status = dialog.querySelector('[role="status"]');
  const save = dialog.querySelector('[type="submit"]'), remove = dialog.querySelector("[data-remove]");
  let busy = false, blob = null, objectUrl = null, version = 0, current = null;
  const close = () => { if (!busy) dialog.close(); };
  dialog.querySelector("[data-close]").onclick = close;
  dialog.oncancel = event => { if (busy) event.preventDefault(); };
  dialog.onclose = () => {
    version++;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    dialog.remove();
  };
  dialog.showModal();
  const readCurrent = async () => {
    const { data, error } = await b.client.rpc("admin_member_photo", { target: person.member_id });
    if (error) throw error;
    return data;
  };
  try {
    current = await readCurrent();
    const urls = await photoUrls([current.avatar_path]);
    if (!dialog.isConnected) return;
    const url = urls[current.avatar_path];
    dialog.querySelector("[data-photo-fields]").innerHTML = `<div class="form-stack"><img id="managedPhotoPreview" class="photo-preview" alt="Profile photo preview for ${e(person.username)}" ${url ? `src="${e(url)}"` : "hidden"}><p data-current-photo>${current.avatar_path ? "Current profile photo" : "No profile photo yet"}</p><label for="managedPhoto">Choose a photo</label><input id="managedPhoto" type="file" accept="image/jpeg,image/png,image/webp"><small>JPEG, PNG or WebP, up to 10 MB. Photos are cropped to a square. Check the preview before saving. Visible to signed-in society members.</small></div>`;
    status.textContent = "";
    remove.hidden = !current.avatar_path;
    const input = dialog.querySelector("#managedPhoto"), preview = dialog.querySelector("#managedPhotoPreview");
    input.onchange = async () => {
      const ticket = ++version;
      blob = null; save.disabled = true;
      status.textContent = "Preparing photo…";
      if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
      preview.hidden = !url;
      if (url) preview.src = url;
      dialog.querySelector("[data-current-photo]").textContent = current.avatar_path ? "Current profile photo" : "No profile photo yet";
      try {
        const selected = await preparePhoto(input.files[0]);
        if (ticket !== version || !dialog.isConnected) return;
        blob = selected;
        if (blob) {
          objectUrl = URL.createObjectURL(blob); preview.src = objectUrl; preview.hidden = false;
          dialog.querySelector("[data-current-photo]").textContent = "New photo preview";
        }
        status.textContent = ""; save.disabled = !blob;
      } catch (error) { if (ticket === version && dialog.isConnected) status.textContent = error.message; }
    };
    const commit = async deleting => {
      if (busy || (!deleting && !blob)) return;
      busy = true; form.inert = true;
      status.textContent = deleting ? "Removing photo…" : "Saving photo…";
      let uploaded = null;
      try {
        if (!deleting) {
          const path = `${current.upload_folder}/${crypto.randomUUID()}.jpg`;
          const { error } = await bucket.upload(path, blob, {contentType:"image/jpeg",cacheControl:"3600",upsert:false});
          if (error) throw error;
          uploaded = path;
        }
        const { error } = await b.client.rpc("admin_save_member_photo", {
          target: person.member_id, photo_path: uploaded, expected_path: current.avatar_path,
        });
        if (error) {
          // A lost response can follow a successful commit. Never delete an image still in use.
          let verified;
          try { verified = await readCurrent(); }
          catch { throw new Error("Could not confirm the save. Reopen this photo editor to check before trying again."); }
          if (verified.avatar_path !== uploaded) {
            if (uploaded) await bucket.remove([uploaded]);
            throw error;
          }
        }
        if (current.avatar_path && current.avatar_path !== uploaded) await bucket.remove([current.avatar_path]);
        await b.refresh();
        dialog.close();
        b.toast(deleting ? "Profile photo removed." : "Profile photo saved.");
      } catch (error) { status.textContent = error.message || "Could not save this photo. Please try again."; }
      finally { busy = false; form.inert = false; }
    };
    form.onsubmit = event => { event.preventDefault(); commit(false); };
    remove.onclick = () => commit(true);
  } catch (error) {
    if (dialog.isConnected) status.textContent = error.message || "Could not load this photo. Close and try again.";
  }
}
