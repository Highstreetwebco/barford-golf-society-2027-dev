import {readFile,writeFile} from 'node:fs/promises';
// A practice-only rendering of the real scoring HTML; no account or database scripts.
let html=await readFile('scoring.html','utf8');
html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace('<title>Event scorecard | Barford Golf Society</title>','<title>Practice scorecard | Barford</title><meta name="robots" content="noindex">');
html=html.replace('<header class="score-app-header">','<div class="score-preview-banner">Practice preview · Nothing here is saved to an event</div><header class="score-app-header">');
html=html.replace('</body>','<script src="assets/js/scoring-preview.js" defer></script><script src="assets/js/score-layout.js" defer></script><script src="assets/js/design-preview.js" defer></script></body>');
await writeFile('scoring-preview.html',html);
