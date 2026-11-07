// Renders tools/seo/og-card.html to icons/og-card.png (1200x630), the image shown when a link to the site is shared.
//   NODE_PATH=$(npm root -g) node tools/seo/og-card.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { chromium } = createRequire((process.env.NODE_PATH || '.') + '/')('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await p.goto(pathToFileURL(path.join(here, 'og-card.html')).href);
await p.screenshot({ path: path.join(here, '../../icons/og-card.png') });
await b.close();
console.log('icons/og-card.png written');
