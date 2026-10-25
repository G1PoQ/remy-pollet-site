// Assemble le site à partir des contenus (dossier content/) et des photos (dossier media/).
// Cloudflare Pages lance ce script à chaque modification enregistrée dans l'administration.
// Résultat : le dossier dist/, qui est ce que Cloudflare met en ligne.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

const OUT = 'dist';
const warnings = [];
const warn = (msg) => { warnings.push(msg); console.warn('⚠ ' + msg); };

/* ---------- Petits outils ---------- */

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
// Cadrage d'un détail de toile : un choix nommé de l'administration, ou un pourcentage (anciens contenus).
const CADRAGES = { haut: 15, 'haut-centre': 33, centre: 50, 'centre-bas': 67, bas: 85 };
const pct = (v, fallback = 50) => {
  if (typeof v === 'string' && CADRAGES[v.trim()] !== undefined) return CADRAGES[v.trim()];
  const n = num(v); return n === null ? fallback : Math.max(0, Math.min(100, n));
};
const slugify = (s) => str(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
const mediaPath = (p) => str(p).replace(/^\/+/, '');
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const escAttr = (s) => str(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
// Rang d'un numéro d'œuvre : « 580 » → 580, « E2014-07 » → 7 (dernier nombre du numéro).
const rank = (n) => { const m = str(n).match(/(\d+)(?!.*\d)/); return m ? Number(m[1]) : 0; };

async function readJSON(file, fallback) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`Fichier introuvable : ${file}`);
  }
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`Fichier mal formé : ${file} (${e.message})`); }
}

async function readCollection(dir) {
  let names = [];
  try { names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json')).sort(); }
  catch { return []; }
  const items = [];
  for (const n of names) {
    try { items.push({ ...(await readJSON(path.join(dir, n))), _file: n }); }
    catch (e) { warn(e.message + ' : ignoré.'); }
  }
  return items;
}

/* ---------- Images ---------- */

// Rotation choisie dans l'administration pour redresser une photo couchée.
const ROTATIONS = { droite: 90, 'demi-tour': 180, gauche: 270 };
const angleOf = (v) => {
  if (typeof v === 'string' && ROTATIONS[v.trim()] !== undefined) return ROTATIONS[v.trim()];
  const n = num(v); return n === null ? 0 : (((Math.round(n / 90) * 90) % 360) + 360) % 360;
};

// Ouvre une photo dans le bon sens : orientation de l'appareil, puis rotation demandée.
async function oriented(file, angle = 0) {
  if (!angle) return sharp(file).rotate();
  return sharp(await sharp(file).rotate().toBuffer()).rotate(angle);
}

// Décode une photo (orientation corrigée) en pixels bruts RVB.
async function decode(file, angle = 0) {
  const { data, info } = await (await oriented(file, angle)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

// Trouve la toile dans une photo de photographe : fond blanc autour, cartel en dessous.
// Si la photo est déjà recadrée (pas de marge blanche), elle est gardée entière.
function findCanvas(img) {
  const { data, width: W, height: H, channels: C } = img;
  const WHITE = 242;
  const patch = (x0, y0) => {
    let s = 0, n = 0;
    for (let y = y0; y < y0 + 16; y++) for (let x = x0; x < x0 + 16; x++) { s += lum(data, (y * W + x) * C); n++; }
    return s / n;
  };
  const corners = [patch(2, 2), patch(W - 18, 2), patch(2, H - 18), patch(W - 18, H - 18)];
  if (Math.min(...corners) < 245) return { left: 0, top: 0, width: W, height: H, cropped: false };

  const sx = Math.max(1, Math.floor(W / 400)), sy = Math.max(1, Math.floor(H / 600));
  const rows = [];
  for (let y = 0; y < H; y += sy) {
    let dark = 0, n = 0;
    for (let x = 0; x < W; x += sx) { if (lum(data, (y * W + x) * C) < WHITE) dark++; n++; }
    rows.push({ y, f: dark / n });
  }
  const longestRun = (arr, test) => {
    let best = null, start = null;
    arr.forEach((v, i) => {
      if (test(v)) { if (start === null) start = i; }
      else if (start !== null) { if (!best || i - start > best[1] - best[0]) best = [start, i]; start = null; }
    });
    if (start !== null && (!best || arr.length - start > best[1] - best[0])) best = [start, arr.length];
    return best;
  };
  // Toile très étroite (par exemple 250 × 90) : elle n'occupe pas la moitié de la largeur de la photo.
  const rowMax = Math.max(...rows.map((v) => v.f));
  const r = longestRun(rows, (v) => v.f > 0.5) || (rowMax > 0.25 ? longestRun(rows, (v) => v.f > rowMax * 0.6) : null);
  if (!r) return { left: 0, top: 0, width: W, height: H, cropped: false };
  const top = rows[r[0]].y, bottom = Math.min(H, rows[r[1] - 1].y + sy);
  const cols = [];
  for (let x = 0; x < W; x += sx) {
    let dark = 0, n = 0;
    for (let y = top; y < bottom; y += sy * 2) { if (lum(data, (y * W + x) * C) < WHITE) dark++; n++; }
    cols.push({ x, f: dark / n });
  }
  const c = longestRun(cols, (v) => v.f > 0.5);
  if (!c) return { left: 0, top: 0, width: W, height: H, cropped: false };
  const left = cols[c[0]].x, right = Math.min(W, cols[c[1] - 1].x + sx);
  const inset = Math.round(Math.min(right - left, bottom - top) * 0.004) + 2;
  const box = { left: left + inset, top: top + inset, width: right - left - 2 * inset, height: bottom - top - 2 * inset, cropped: true };
  if (box.width * box.height < W * H * 0.12) return { left: 0, top: 0, width: W, height: H, cropped: false };
  return box;
}

function average(img, box) {
  const { data, width: W, channels: C } = img;
  let r = 0, g = 0, b = 0, n = 0;
  const step = Math.max(1, Math.floor(Math.min(box.width, box.height) / 120));
  for (let y = box.top; y < box.top + box.height; y += step) {
    for (let x = box.left; x < box.left + box.width; x += step) {
      const i = (y * W + x) * C; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  return { hex: toHex(r / n, g / n, b / n), lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / n / 255 };
}

function region(img, box) {
  return sharp(img.data, { raw: { width: img.width, height: img.height, channels: img.channels } })
    .extract({ left: box.left, top: box.top, width: box.width, height: box.height });
}

async function writeJpeg(pipeline, file, size) {
  const info = await pipeline.resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 84, progressive: true, mozjpeg: true }).toFile(file);
  return { w: info.width, h: info.height };
}

const sources = new Map(); // slug -> { file, recadrer, angle }

async function processWork(file, slug, recadrer = true, angle = 0) {
  if (!recadrer) {
    // Photo déjà recadrée : pas besoin de décoder l'image entière.
    sources.set(slug, { file, recadrer, angle });
    const base = await oriented(file, angle);
    const full = await writeJpeg(base.clone(), `${OUT}/img/o/${slug}.jpg`, 1600);
    const small = await writeJpeg(base.clone(), `${OUT}/img/o/${slug}-s.jpg`, 720);
    const { data, info } = await base.clone().removeAlpha().resize(48, 48, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    let r = 0, g = 0, b = 0; const n = info.width * info.height;
    for (let i = 0; i < data.length; i += info.channels) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
    return { fw: full.w, fh: full.h, sw: small.w, sh: small.h, bg: toHex(r / n, g / n, b / n), recadree: false };
  }
  const img = await decode(file, angle);
  const box = recadrer ? findCanvas(img) : { left: 0, top: 0, width: img.width, height: img.height, cropped: false };
  sources.set(slug, { file, recadrer, angle });
  const full = await writeJpeg(region(img, box), `${OUT}/img/o/${slug}.jpg`, 1600);
  const small = await writeJpeg(region(img, box), `${OUT}/img/o/${slug}-s.jpg`, 720);
  return { fw: full.w, fh: full.h, sw: small.w, sh: small.h, bg: average(img, box).hex, recadree: box.cropped };
}

async function processHero(slug, position) {
  const { file, recadrer, angle } = sources.get(slug);
  const img = await decode(file, angle);
  const box = recadrer ? findCanvas(img) : { left: 0, top: 0, width: img.width, height: img.height };
  const bandH = Math.min(box.height, Math.round(box.width / 2));
  const top = box.top + Math.round((box.height - bandH) * position / 100);
  const band = { left: box.left, top, width: box.width, height: bandH };
  await region(img, band).resize({ width: 2000, withoutEnlargement: true })
    .jpeg({ quality: 84, progressive: true, mozjpeg: true }).toFile(`${OUT}/img/entete.jpg`);
  return average(img, band);
}

const looseDone = new Map();
async function processLoose(p) {
  const rel = mediaPath(p);
  if (!rel) return null;
  if (looseDone.has(rel)) return looseDone.get(rel);
  try {
    const name = slugify(path.dirname(rel).replace(/^media\/?/, '') + '-' + path.basename(rel, path.extname(rel)));
    const base = sharp(rel).rotate().flatten({ background: '#ffffff' });
    const info = await base.clone().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 84, progressive: true, mozjpeg: true }).toFile(`${OUT}/img/m/${name}.jpg`);
    const small = await base.clone().resize({ width: 520, height: 520, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true, mozjpeg: true }).toFile(`${OUT}/img/m/${name}-s.jpg`);
    const out = { src: `img/m/${name}.jpg`, w: info.width, h: info.height, s: `img/m/${name}-s.jpg`, sw: small.width, sh: small.height };
    looseDone.set(rel, out);
    return out;
  } catch {
    warn(`Image introuvable ou illisible : ${rel}`);
    return null;
  }
}

/* ---------- Polices ---------- */

const FONTS = {
  titres: {
    palatino: { css: "'Palatino Linotype', Palatino, 'Book Antiqua', 'URW Palladio L', 'TeX Gyre Pagella', P052, 'Gentium Book Plus', Georgia, serif", g: 'Gentium+Book+Plus:ital,wght@0,400;0,700;1,400' },
    cormorant: { css: "'Cormorant Garamond', Garamond, 'Times New Roman', serif", g: 'Cormorant+Garamond:ital,wght@0,400;0,500;1,400' },
    garamond: { css: "'EB Garamond', Garamond, 'Times New Roman', serif", g: 'EB+Garamond:ital,wght@0,400;0,500;1,400' },
    caslon: { css: "'Libre Caslon Text', 'Big Caslon', Georgia, serif", g: 'Libre+Caslon+Text:ital,wght@0,400;0,700;1,400' }
  },
  texte: {
    hanken: { css: "'Hanken Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif", g: 'Hanken+Grotesk:wght@300;400;500' },
    jost: { css: "Jost, 'Helvetica Neue', Helvetica, Arial, sans-serif", g: 'Jost:wght@300;400;500' },
    source: { css: "'Source Sans 3', 'Helvetica Neue', Helvetica, Arial, sans-serif", g: 'Source+Sans+3:wght@300;400;500' }
  }
};

/* ---------- Construction ---------- */

async function main() {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(`${OUT}/img/o`, { recursive: true });
  await fs.mkdir(`${OUT}/img/m`, { recursive: true });

  const site = await readJSON('content/site.json', {});

  // Œuvres
  const works = [];
  const byNumero = new Map();
  const slugs = new Set();
  const todo = [];
  for (const r of await readCollection('content/oeuvres')) {
    if (r.masquer === true) continue;
    const w = {
      n: str(r.numero), t: str(r.titre), y: num(r.annee), h: num(r.hauteur), w: num(r.largeur),
      s: str(r.serie), tech: str(r.technique) || 'Huile sur toile', dispo: str(r.disponibilite), texte: str(r.texte)
    };
    // Titre facultatif : à défaut, le nom de la série, puis le numéro.
    if (!w.t) w.t = w.s || (w.n ? `N° ${w.n}` : '');
    const photo = mediaPath(r.photo);
    if (!w.n || !w.y || !w.h || !w.w || !photo) {
      warn(`Œuvre « ${w.t || r._file} » non publiée : il manque le numéro, l'année, la hauteur, la largeur ou la photo.`);
      continue;
    }
    if (byNumero.has(w.n)) warn(`Deux œuvres portent le numéro ${w.n} : vérifiez « ${w.t} ».`);
    let slug = slugify(w.n);
    while (slugs.has(slug)) slug += '-b';
    slugs.add(slug);
    w.slug = slug;
    todo.push({ w, photo, recadrer: r.deja_recadree !== true, angle: angleOf(r.rotation) });
  }
  // Photos traitées plusieurs à la fois (plusieurs centaines d'œuvres).
  const failed = new Set();
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const job = todo[next++];
      try {
        Object.assign(job.w, await processWork(job.photo, job.w.slug, job.recadrer, job.angle));
        // Le format suit le sens de l'image : une œuvre en hauteur a sa plus grande mesure en hauteur.
        const w = job.w, ratio = w.fw / w.fh;
        if (w.h !== w.w && (ratio > 1.06 || ratio < 1 / 1.06) && (w.fh > w.fw) !== (w.h > w.w)) {
          [w.h, w.w] = [w.w, w.h];
          console.log(`Œuvre ${w.n} : hauteur et largeur inversées pour suivre le sens de la photo (${w.h} × ${w.w}).`);
        }
      }
      catch { warn(`Photo introuvable ou illisible pour « ${job.w.t} » (${job.photo}) : œuvre non publiée.`); failed.add(job); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(2, Math.min(6, os.availableParallelism ? os.availableParallelism() : os.cpus().length)) }, worker));
  for (const job of todo) {
    if (failed.has(job)) continue;
    works.push(job.w);
    if (!byNumero.has(job.w.n)) byNumero.set(job.w.n, job.w);
  }
  works.sort((a, b) => b.y - a.y || rank(b.n) - rank(a.n));
  const ref = (v) => byNumero.get(str(v));
  const refs = (v) => asList(v).map(ref).filter(Boolean).map((w) => w.slug);
  const yearRange = (ws) => {
    if (!ws.length) return '';
    const a = Math.min(...ws.map((w) => w.y)), b = Math.max(...ws.map((w) => w.y));
    return a === b ? String(a) : `${a} – ${b}`;
  };

  // Séries (celles saisies, puis celles qui n'existent que dans les œuvres)
  const rawSeries = (await readCollection('content/series'))
    .sort((a, b) => (num(a.ordre) ?? 999) - (num(b.ordre) ?? 999) || str(a.nom).localeCompare(str(b.nom), 'fr'));
  const series = [];
  const seen = new Set();
  for (const s of rawSeries) {
    const nom = str(s.nom);
    if (!nom || seen.has(nom)) continue;
    seen.add(nom);
    const ws = works.filter((w) => w.s === nom);
    if (!ws.length) continue;
    const cw = ref(s.presentation) || ws[0];
    series.push({ nom, annees: str(s.annees) || yearRange(ws), count: ws.length, description: str(s.description),
      cover: { slug: cw.slug, pos: `50% ${pct(s.cadrage)}%` } });
  }
  for (const w of works) {
    if (w.s && !seen.has(w.s)) {
      seen.add(w.s);
      const ws = works.filter((x) => x.s === w.s);
      series.push({ nom: w.s, annees: yearRange(ws), count: ws.length, description: '', cover: { slug: ws[0].slug, pos: '50% 50%' } });
    }
  }

  // Années
  const yearSettings = asList(await readJSON('content/annees.json', []));
  const years = [...new Set(works.map((w) => w.y))].sort((a, b) => b - a).map((y) => {
    const o = yearSettings.find((e) => num(e.annee) === y);
    const ws = works.filter((w) => w.y === y);
    const cw = (o && ref(o.presentation)) || ws[0];
    return { nom: String(y), count: ws.length, cover: { slug: cw.slug, pos: `50% ${pct(o ? o.cadrage : 50)}%` } };
  });

  // En-tête
  const ent = site.entete || {};
  const heroWork = ref(ent.oeuvre) || works[0];
  let hero = null;
  if (heroWork) {
    const position = pct(ent.position);
    const tone = await processHero(heroWork.slug, position);
    hero = { slug: heroWork.slug, src: 'img/entete.jpg', mobile: `img/o/${heroWork.slug}.jpg`, mpos: `50% ${position}%`,
      tone: tone.lum < 0.5 ? 'dark' : 'light', bg: tone.hex };
  }

  // Accueil
  const accueil = await readJSON('content/accueil.json', { sections: [] });
  const sections = [];
  for (const b of asList(accueil.sections)) {
    if (!b || b.masquer === true) continue;
    const type = str(b.type);
    const base = { type, surtitre: str(b.surtitre), titre: str(b.titre), texte: str(b.texte) };
    if (type === 'accrochage') sections.push({ ...base, oeuvres: refs(b.oeuvres).slice(0, 6), lien_formats: b.lien_formats !== false });
    else if (type === 'catalogue') sections.push({ ...base, lien: str(b.lien), libelle_bouton: str(b.libelle_bouton) || 'Feuilleter le catalogue',
      couverture: b.couverture ? await processLoose(b.couverture) : null, oeuvre: refs(b.oeuvre)[0] || null, exemplaire: b.exemplaire !== false });
    else if (type === 'citation') sections.push({ type, texte: str(b.texte), auteur: str(b.auteur) });
    else if (type === 'parcours') sections.push({ ...base, lien_bio: b.lien_bio !== false,
      etapes: asList(b.etapes).map((e) => ({ annee: str(e.annee), texte: str(e.texte) })).filter((e) => e.annee || e.texte) });
    else if (type === 'texte') sections.push({ ...base, image: b.image ? await processLoose(b.image) : null, fond: str(b.fond) || 'Clair' });
    else if (type === 'oeuvres') sections.push({ ...base, oeuvres: refs(b.oeuvres), nombre: num(b.nombre) || 3 });
    else if (type === 'series') sections.push({ ...base });
    else if (type === 'expositions') sections.push({ ...base, nombre: num(b.nombre) || 4 });
    else if (type) warn(`Section d'accueil inconnue ignorée : ${type}`);
  }

  // Pages
  const bio = await readJSON('content/biographie.json', {});
  const expo = await readJSON('content/expositions.json', {});
  const TARGETS = { accueil: '#accueil', oeuvres: '#oeuvres', expositions: '#expositions', biographie: '#biographie', contact: '#contact' };
  const menu = asList(site.menu).map((m) => {
    const cible = str(m.cible) || 'lien';
    const href = cible === 'lien' ? str(m.lien) : TARGETS[cible];
    if (!href || !str(m.libelle)) return null;
    return { libelle: str(m.libelle), href, key: cible === 'lien' ? '' : cible, externe: cible === 'lien', bouton: m.bouton === true };
  }).filter(Boolean);
  const contact = site.contact || {};

  const data = {
    site: {
      nom: str(site.nom) || 'Rémy Pollet',
      sous_titre: str(site.sous_titre),
      menu,
      contact: { intro: str(contact.intro), email: str(contact.email), telephone: str(contact.telephone),
        adresse: str(contact.adresse), visites: str(contact.visites), instagram: str(contact.instagram),
        cle: str(contact.cle_formulaire) },
      pied_de_page: str(site.pied_de_page)
    },
    hero, works, series, years,
    accueil: sections,
    biographie: { intro: str(bio.intro), oeuvre: refs(bio.oeuvre)[0] || null,
      portrait: bio.portrait ? await processLoose(bio.portrait) : null, legende: str(bio.legende_portrait),
      etapes: asList(bio.etapes).map((e) => ({ periode: str(e.periode), texte: str(e.texte) })).filter((e) => e.periode || e.texte) },
    expositions: { intro: str(expo.intro),
      liste: (await Promise.all(asList(expo.liste).map(async (x) => ({ date: str(x.date), titre: str(x.titre), lieu: str(x.lieu), organisateur: str(x.organisateur),
        photos: (await Promise.all(asList(x.photos).map((p) => processLoose(typeof p === 'object' && p ? p.image : p)))).filter(Boolean) }))))
        .filter((x) => x.titre || x.date) }
  };

  // Page HTML
  const pol = site.polices || {};
  const ft = FONTS.titres[str(pol.titres)] || FONTS.titres.palatino;
  const fb = FONTS.texte[str(pol.texte)] || FONTS.texte.hanken;
  const seo = site.referencement || {};
  const title = str(seo.titre) || `${data.site.nom} · Peintre`;
  const head = [
    `<title>${escAttr(title)}</title>`,
    `<meta name="description" content="${escAttr(seo.description)}">`,
    seo.visible_google === true ? '' : '<meta name="robots" content="noindex">',
    `<meta property="og:title" content="${escAttr(title)}">`,
    `<meta property="og:description" content="${escAttr(seo.description)}">`,
    '<link rel="icon" href="favicon.svg" type="image/svg+xml">',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${ft.g}&family=${fb.g}&family=Courier+Prime:ital@1&display=swap">`,
    `<style>:root{--display:${ft.css};--body:${fb.css}}</style>`
  ].filter(Boolean).join('\n');
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const template = await fs.readFile('src/index.html', 'utf8');
  if (!template.includes('<!--HEAD-->') || !template.includes('__DATA__')) throw new Error('Gabarit src/index.html incomplet.');
  await fs.writeFile(`${OUT}/index.html`, template.replace('<!--HEAD-->', head).replace('__DATA__', () => json));
  await fs.copyFile('src/favicon.svg', `${OUT}/favicon.svg`);

  console.log(`Site assemblé : ${works.length} œuvres, ${series.length} séries, ${sections.length} sections d'accueil.`);
  const recadrees = works.filter((w) => w.recadree).length;
  console.log(`Photos recadrées automatiquement : ${recadrees} sur ${works.length}.`);
  if (warnings.length) console.log(`${warnings.length} avertissement(s), voir ci-dessus.`);
}

main().catch((e) => { console.error('Échec de la construction : ' + e.message); process.exit(1); });
