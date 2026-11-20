// Range chaque encre dans le dossier de son année et crée au besoin la liste « Encres <année> »
// dans l'administration (.pages.yml). Lancé automatiquement par GitHub après chaque enregistrement
// d'une encre (.github/workflows/ranger-encres.yml) ; peut aussi se lancer à la main : node outils/ranger-encres.mjs
import { promises as fs, existsSync } from 'node:fs';

const BASE = 'content/oeuvres/encres';
const CONFIG = '.pages.yml';
const isYear = (s) => /^\d{4}$/.test(s);

// 1. Déplacer les fiches dont l'année ne correspond pas au dossier
const dirs = (await fs.readdir(BASE, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
const moved = [];
for (const dir of dirs) {
  for (const f of (await fs.readdir(`${BASE}/${dir}`)).filter((n) => n.endsWith('.json'))) {
    const src = `${BASE}/${dir}/${f}`;
    let fiche;
    try { fiche = JSON.parse(await fs.readFile(src, 'utf8')); } catch { console.log(`⚠ fiche illisible, laissée en place : ${src}`); continue; }
    const y = parseInt(String(fiche.annee ?? '').trim(), 10);
    if (!(y >= 1900 && y <= 2100) || String(y) === dir) continue;
    const dest = `${BASE}/${y}/${f}`;
    if (existsSync(dest)) { console.log(`⚠ ${dest} existe déjà : ${src} laissée en place`); continue; }
    await fs.mkdir(`${BASE}/${y}`, { recursive: true });
    await fs.rename(src, dest);
    moved.push(`${src} → ${dest}`);
  }
}

// 2. Une liste dans l'administration pour chaque année qui a au moins une encre
const years = [];
for (const d of (await fs.readdir(BASE, { withFileTypes: true }))) {
  if (d.isDirectory() && isYear(d.name) && (await fs.readdir(`${BASE}/${d.name}`)).some((n) => n.endsWith('.json'))) years.push(d.name);
}
years.sort();
let yml = await fs.readFile(CONFIG, 'utf8');
const blockRe = /^      - name: encres-(\d{4})\n/gm;
const blocks = [...yml.matchAll(blockRe)].map((m) => ({ year: m[1], index: m.index }));
const autres = yml.indexOf('      - name: encres-autres\n');
if (!blocks.length || autres < 0) throw new Error('Listes des encres introuvables dans .pages.yml');
// Modèle : la liste de la première année existante, jusqu'à la liste suivante
const t = blocks[0], tEnd = blocks[1] ? blocks[1].index : autres;
const template = yml.slice(t.index, tEnd);
const added = [];
for (const y of years) {
  if (blocks.some((b) => b.year === y) || added.includes(y)) continue;
  const block = template
    .replace(new RegExp(`encres-${t.year}`, 'g'), `encres-${y}`)
    .replace(new RegExp(`Encres ${t.year}`, 'g'), `Encres ${y}`)
    .replace(new RegExp(`encres/${t.year}`, 'g'), `encres/${y}`)
    .replace(new RegExp(`datées de ${t.year}`, 'g'), `datées de ${y}`);
  // Insérée avant la première liste d'une année plus récente, sinon avant « nouvelle année »
  const current = [...yml.matchAll(blockRe)].map((m) => ({ year: m[1], index: m.index }));
  const next = current.find((b) => b.year > y);
  const at = next ? next.index : yml.indexOf('      - name: encres-autres\n');
  yml = yml.slice(0, at) + block + yml.slice(at);
  added.push(y);
}
if (added.length) await fs.writeFile(CONFIG, yml);

console.log(moved.length ? `Fiches rangées :\n  ${moved.join('\n  ')}` : 'Aucune fiche à déplacer.');
console.log(added.length ? `Listes ajoutées dans l'administration : ${added.map((y) => 'Encres ' + y).join(', ')}` : 'Aucune liste à ajouter.');
