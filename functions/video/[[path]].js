// Vidéos du site (dossier dist/video), servies par morceaux.
//
// Cloudflare Pages ne répond pas aux demandes « Range » (un morceau d'un fichier) : il renvoie
// toujours le fichier entier (réponse 200). Chrome et Firefox s'en accommodent, mais Safari
// (Mac, iPhone, iPad) refuse alors de lire la vidéo. Cette fonction lit le fichier mis en ligne
// et renvoie seulement le morceau demandé (réponse 206), comme le ferait un serveur classique.
// Cloudflare la lance pour chaque adresse /video/… (offre gratuite : 100 000 lancements par jour).

export async function onRequest({ request, env, waitUntil }) {
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Méthode non autorisée', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  // Le fichier entier, non compressé, pour que les positions en octets soient justes.
  const asset = await env.ASSETS.fetch(new Request(request.url, { method: 'GET', headers: { 'Accept-Encoding': 'identity' } }));
  if (asset.status !== 200 || !asset.body) return asset;

  const headers = new Headers(asset.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.delete('Content-Encoding');
  const range = (request.headers.get('Range') || '').trim();
  let total = Number(asset.headers.get('Content-Length'));
  let whole = () => new Response(asset.body, { status: 200, headers });

  if (method === 'HEAD') { asset.body.cancel(); return new Response(null, { status: 200, headers }); }
  if (!range) return whole();

  // Taille inconnue (pas d'en-tête Content-Length) : le fichier est lu une fois en mémoire
  // (25 Mo au plus, limite de Cloudflare Pages), puis découpé sans copie.
  let data = null;
  if (!(total > 0)) {
    data = new Uint8Array(await asset.arrayBuffer());
    total = data.byteLength;
    headers.set('Content-Length', String(total));
    whole = () => new Response(data, { status: 200, headers });
  }
  const cancel = () => { if (!data) asset.body.cancel(); };
  const ifRange = request.headers.get('If-Range');
  if (ifRange && ifRange !== asset.headers.get('ETag')) return whole();

  // Une seule plage : « bytes=a-b », « bytes=a- » ou « bytes=-n » ; sinon, le fichier entier.
  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!m || (m[1] === '' && m[2] === '')) return whole();
  let start, end;
  if (m[1] === '') { start = Math.max(0, total - Number(m[2])); end = total - 1; }
  else { start = Number(m[1]); end = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1); }
  if (start >= total || start > end) {
    cancel();
    return new Response('Plage non disponible', { status: 416, headers: { 'Content-Range': `bytes */${total}`, 'Cache-Control': 'no-store' } });
  }

  const size = end - start + 1;
  headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
  headers.set('Content-Length', String(size));
  if (data) return new Response(data.subarray(start, end + 1), { status: 206, headers });
  const { readable, writable } = new FixedLengthStream(size);
  waitUntil(copySlice(asset.body, start, end + 1, writable));
  return new Response(readable, { status: 206, headers });
}

// Recopie les octets [start, stop[ du flux source dans le flux de réponse.
async function copySlice(body, start, stop, writable) {
  const reader = body.getReader();
  const writer = writable.getWriter();
  let pos = 0;
  try {
    while (pos < stop) {
      const { value, done } = await reader.read();
      if (done) break;
      const from = pos, to = pos + value.byteLength;
      pos = to;
      if (to <= start) continue;
      await writer.write(value.subarray(Math.max(0, start - from), Math.min(value.byteLength, stop - from)));
    }
    await writer.close();
  } catch (e) {
    try { await writer.abort(e); } catch {}
  }
  try { await reader.cancel(); } catch {}
}
