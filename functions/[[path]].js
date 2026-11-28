// Anciennes adresses (site WordPress, liens Google, favoris) : remypollet.com/biographie/, /oeuvres/…
//
// Le site n'a qu'une page (index.html). Sans cette fonction, Cloudflare la sert à toutes les adresses
// inconnues, avec la réponse « 200 » : Google garde alors les anciennes pages WordPress dans ses résultats
// (« Biographie - remypollet.com » au lieu de l'accueil). Ici, toute adresse qui ne correspond à aucun
// fichier du site est renvoyée définitivement (301) vers l'accueil, en ouvrant la partie reconnue dans
// l'ancienne adresse ; Google remplace alors l'ancien résultat par l'accueil.
//
// Lancée seulement pour les adresses qui ne sont ni l'accueil, ni les images, ni les icônes
// (voir _routes.json, écrit par build.mjs) ; les vidéos ont leur propre fonction (functions/video).

const PARTIES = [
  [/biograph/, '#biographie'],
  [/expo/, '#expositions'],
  [/contact/, '#contact'],
  [/encre/, '#oeuvres/encres'],
  [/dessin/, '#oeuvres/dessins'],
  [/huile|toile/, '#oeuvres/huiles'],
  [/oeuvre|œuvre|galerie|serie|série|portfolio|travaux/, '#oeuvres'],
];

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const res = await env.ASSETS.fetch(request);
  const html = (res.headers.get('content-type') || '').startsWith('text/html');
  // Un vrai fichier (ou une redirection de Cloudflare, comme /index.html → /) : servi tel quel.
  if (url.pathname === '/' || res.status !== 200 || !html) return res;
  // Une page HTML à une autre adresse que l'accueil : c'est la page de secours, l'adresse n'existe pas.
  if (res.body) res.body.cancel();
  let chemin = url.pathname;
  try { chemin = decodeURIComponent(chemin); } catch {}
  chemin = chemin.toLowerCase();
  const partie = PARTIES.find(([motif]) => motif.test(chemin));
  return new Response(null, {
    status: 301,
    headers: { Location: `${url.origin}/${partie ? partie[1] : ''}`, 'Cache-Control': 'public, max-age=86400' },
  });
}
