// Each opaque invitation is a capability for one RSVP. It never grants site access.
const API_KEY = 'sb_publishable_xLM39PjQf4XdTVfNHFOzAQ_i4re6w_c';
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey,content-type', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export function jpegBytes(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length > 700000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Choose a valid JPEG photo.');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0)); } catch { throw new Error('Choose a valid JPEG photo.'); }
  if (bytes.length > 512000 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new Error('Choose a valid JPEG photo smaller than 500 KB.');
  let offset = 2, valid = false;
  while (offset + 8 < bytes.length) {
    if (bytes[offset++] !== 255) break;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 218 || marker === 217) break;
    const length = (bytes[offset] << 8) + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if ([192,193,194].includes(marker)) {
      const height = (bytes[offset+3] << 8) + bytes[offset+4], width = (bytes[offset+5] << 8) + bytes[offset+6];
      valid = width > 0 && height > 0 && width <= 640 && height <= 640;
      break;
    }
    offset += length;
  }
  if (!valid) throw new Error('The photo could not be read. Choose another image.');
  return bytes;
}
async function readBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('Missing request.');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > 750000) { await reader.cancel(); throw new Error('Request too large.'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk,at); at += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('Invalid request.'); }
}
export function createHandler(env: { url: string; service: string; anon: string }, request = fetch) {
  const serviceHeaders = { apikey: env.service, Authorization: 'Bearer ' + env.service, 'Content-Type': 'application/json' };
  const call = async (path: string, method = 'POST', body?: unknown, extra = {}) => {
    const response = await request(env.url + path, { method, headers: {...serviceHeaders,...extra}, body: body instanceof Uint8Array ? body : body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Only deliberate PostgreSQL validation messages are safe to expose.
      throw new Error(data.code === 'P0001' ? data.message : 'We could not complete that request. Please try again.');
    }
    return data;
  };
  const rpc = (action: string, payload: unknown) => call('/rest/v1/rpc/baseline_guest_rsvp','POST',{action,payload});
  const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))), x => x.toString(16).padStart(2,'0')).join('');
  const clean = async (data: any) => {
    if (data.avatar_path) {
      const signed = await call('/storage/v1/object/sign/baseline-profile-images/' + data.avatar_path,'POST',{expiresIn:900}).catch(() => null);
      if (signed?.signedURL) data.photo_url = env.url + '/storage/v1' + signed.signedURL;
    }
    // Internal storage paths and roster identity never go to the guest browser.
    delete data.avatar_path; delete data.previous_path; delete data.member_id;
    return data;
  };
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('',{headers});
    if (req.method !== 'POST') return reply({error:'Use POST.'},405);
    if (![API_KEY,env.anon].filter(Boolean).includes(req.headers.get('apikey') || '')) return reply({error:'Invalid project key.'},401);
    try {
      const body = await readBody(req);
      if (!body || !['view','save','photo','remove_photo'].includes(body.action) || !uuid.test(body.token || '')) return reply({error:'This invitation is unavailable. Open the complete link from your inviting member.'},400);
      const token = body.token, hash = await digest(token);
      if (!await call('/rest/v1/rpc/baseline_take_budget','POST',{bucket:'guest:'+hash,seconds:600,maximum:100})) return reply({error:'Too many attempts. Please wait a few minutes and try again.'},429);
      if (body.action === 'view') return reply(await clean(await rpc('view',{token})));
      if (body.action === 'save') {
        const source = body.payload || {}, payload: Record<string,unknown> = {token};
        for (const key of ['revision','host_id','attending','full_name','phone','email','guest_handicap','buggy','preferred_time','guest_price','accept_terms','terms_snapshot']) payload[key] = source[key];
        return reply(await clean(await rpc('save',payload)));
      }
      if (!await call('/rest/v1/rpc/baseline_take_budget','POST',{bucket:'guest-photo:'+hash,seconds:3600,maximum:12})) return reply({error:'Too many photo changes. Please try again later.'},429);
      const current = await rpc('photo_check',{token});
      let path: string | null = null;
      if (body.action === 'photo') {
        const bytes = jpegBytes(body.photo);
        path = current.member_id + '/' + crypto.randomUUID() + '.jpg';
        await call('/storage/v1/object/baseline-profile-images/'+path,'POST',bytes,{'Content-Type':'image/jpeg','x-upsert':'false'});
      }
      let saved;
      try { saved = await rpc('photo_save',{token,photo_path:path,expected_path:current.avatar_path}); }
      catch (error) {
        // A network failure may follow a successful commit. Delete only if verified unused.
        const check = await rpc('view',{token}).catch(() => null);
        if (path && check && check.avatar_path !== path) await call('/storage/v1/object/baseline-profile-images','DELETE',{prefixes:[path]}).catch(() => {});
        throw error;
      }
      if (current.avatar_path && current.avatar_path !== path) await call('/storage/v1/object/baseline-profile-images','DELETE',{prefixes:[current.avatar_path]}).catch(() => {});
      return reply(await clean(saved));
    } catch (error) { return reply({error:error instanceof Error ? error.message : 'Could not save your RSVP. Please try again.'},400); }
  };
}
if (typeof Deno !== 'undefined') Deno.serve(createHandler({url:Deno.env.get('SUPABASE_URL')!,service:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,anon:Deno.env.get('SUPABASE_ANON_KEY')!}));
