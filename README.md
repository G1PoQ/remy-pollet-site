# Site de Rémy Pollet

Site vitrine du peintre Rémy Pollet. Les contenus se modifient dans l'administration
(Pages CMS, app.pagescms.org). Chaque enregistrement met le site à jour sur Cloudflare Pages en une à deux minutes.
Les messages de la page Contact sont envoyés par Web3Forms à l'adresse liée à la clé saisie dans
Réglages du site › Contact.

## Où se trouve quoi

| Dossier ou fichier | Contenu | Modifié depuis l'administration |
|---|---|---|
| `content/oeuvres/` | Une fiche par œuvre, rangée dans `huiles/`, `encres/<année>/` ou `dessins/` | Huiles, Encres de Chine, Dessins |
| `content/series/` | Les séries et leur image de présentation | Catalogue › Séries |
| `content/annees.json` | L'image de présentation de chaque année | Catalogue › Images des années |
| `content/accueil.json` | Les sections de la page d'accueil, dans l'ordre | Pages › Accueil |
| `content/biographie.json` | La biographie | Pages › Biographie |
| `content/expositions.json` | La liste des expositions | Pages › Expositions |
| `content/site.json` | Nom, menu, polices, toile d'en-tête, coordonnées, référencement | Réglages du site |
| `media/oeuvres/` | Les photos des œuvres, telles que fournies par le photographe | (envoi de photo) |
| `media/images/` | Les autres images (couverture du catalogue, etc.) | (envoi d'image) |

## Fonctionnement technique

- `src/index.html` est le gabarit du site (mise en page, styles, navigation).
- `build.mjs` assemble le site : il recadre les photos (fond blanc et cartel retirés automatiquement),
  prépare les tailles d'image, découpe le bandeau d'en-tête, applique les polices choisies et
  injecte les contenus. Le résultat est écrit dans `dist/`.
- Hébergement Cloudflare Pages : commande de construction `npm run build`, dossier publié `dist`.
- `.pages.yml` décrit les formulaires de l'administration.

Pour assembler le site sur un ordinateur : `npm install` puis `node build.mjs`.
