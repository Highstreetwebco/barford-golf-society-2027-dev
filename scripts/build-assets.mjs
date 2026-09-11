// Generated files are committed because GitHub Pages serves this repository directly.
// Run npm ci && npm run build after editing source CSS/JS or page markup.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as esbuild from 'esbuild';
const root=process.cwd(), out='assets/dist', release=80;
await mkdir(out,{recursive:true});
const read=file=>readFile(file,'utf8');
const hash=content=>createHash('sha256').update(content).digest('hex').slice(0,12);
const manifest={release,assets:{},pages:{},pageHashes:{}};
const previous=await read('assets/asset-manifest.json').then(JSON.parse).catch(()=>({assets:{}}));
const reverse=new Map(Object.entries(previous.assets).map(([source,built])=>[built,source]));
const emit=async(name,ext,contents)=>{const dest=`${out}/${name}.${hash(contents)}.${ext}`;await writeFile(dest,contents);return dest;};
const css=new Map();
async function buildCss(sources){
 const key=sources.join(',');if(css.has(key))return css.get(key);
 const contents=(await Promise.all(sources.map(read))).join('\n');
 const result=await esbuild.transform(contents,{loader:'css',minify:true,target:['safari15','chrome100'],legalComments:'inline'});
 const dest=await emit(sources.length===1?path.basename(sources[0],'.css'):sources.includes('assets/css/clubhouse.css')?'member-ui':path.basename(sources[0],'.css')+'-bundle','css',result.code);
 css.set(key,dest);if(sources.length===1)manifest.assets[sources[0]]=dest;return dest;
}
const building=new Set();
async function buildJs(file){
 if(manifest.assets[file])return manifest.assets[file];
 if(building.has(file))throw new Error('Circular dynamic script dependency: '+file);
 building.add(file);let contents=await read(file);
 const references=[...new Set(contents.match(/assets\/(?:js|css)\/[\w-]+\.(?:js|css)(?:\?[^\s"'`<>)]*)?/g)||[])];
 for(const reference of references){const source=reference.split('?')[0];const built=source.endsWith('.css')?await buildCss([source]):await buildJs(source);contents=contents.split(reference).join(built);}
 let code;
 if(/^import\s/m.test(contents)){
  const result=await esbuild.build({stdin:{contents,resolveDir:path.resolve(path.dirname(file)),sourcefile:path.basename(file),loader:'js'},bundle:true,write:false,minify:true,format:'esm',platform:'browser',target:['safari15','chrome100'],legalComments:'inline'});code=result.outputFiles[0].text;
 }else code=(await esbuild.transform(contents,{loader:'js',minify:true,target:['safari15','chrome100'],legalComments:'inline'})).code;
 const dest=await emit(path.basename(file,'.js'),'js',code);manifest.assets[file]=dest;building.delete(file);return dest;
}
const vendor=await esbuild.build({stdin:{contents:'import { createClient } from "@supabase/supabase-js"; window.supabase={createClient};',resolveDir:root},bundle:true,write:false,minify:true,format:'iife',platform:'browser',target:['safari15','chrome100'],legalComments:'inline'});
manifest.sdk=await emit('supabase-2.116.0','js',vendor.outputFiles[0].text);
for(const page of (await readdir('.')).filter(name=>name.endsWith('.html'))){
 let html=await read(page);const pageAssets=[];
 // Bundle only across positions with no intervening inline stylesheet or script.
 // Moving a final override ahead of inline CSS would change the approved design.
 const styleTags=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)];
 const segments=[];let segment=[];
 for(const match of styleTags){
  if(segment.length){const last=segment.at(-1);if(/<style\b|<script\b|<link[^>]*rel="stylesheet"/i.test(html.slice(last.index+last[0].length,match.index))){segments.push(segment);segment=[];}}
  segment.push(match);
 }
 if(segment.length)segments.push(segment);
 for(const tags of segments){
  const styles=tags.flatMap(([tag])=>{const existing=tag.match(/data-css-sources="([^"]+)"/);if(existing)return existing[1].split(',');const href=tag.match(/href="([^"]+)"/)?.[1].split('?')[0];return href?.startsWith('assets/')?[reverse.get(href)||href]:[];});
  if(!styles.length)continue;
  const groups=[];let rest=[...styles];if(rest[0]==='assets/css/styles.css')groups.push(rest.splice(0,1));
  const tailAllowed=new Set(['accessible-mobile','personal-theme','member-simple','clubhouse'].map(name=>'assets/css/'+name+'.css'));
  let tail=rest.length;while(tail>0&&tailAllowed.has(rest[tail-1]))tail--;
  if(tail>0)groups.push(rest.slice(0,tail));if(tail<rest.length)groups.push(rest.slice(tail));
  const links=[];
  for(const group of groups){const built=await buildCss(group);pageAssets.push(built);links.push(`<link rel="stylesheet" href="${built}" data-css-sources="${group.join(',')}"${group.includes('assets/css/personal-theme.css')?' data-ui-ready data-personal-theme':''}>`);}
  let first=true;for(const [tag] of tags){if(!/href="assets\//.test(tag))continue;html=html.replace(tag,first?links.join('\n'):'');first=false;}
 }
 for(const [tag,url] of [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)]){
  const source=reverse.get(url.split('?')[0])||url.split('?')[0];let built;
  if(url.startsWith('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@')||url===previous.sdk)built=manifest.sdk;
  else if(source.startsWith('assets/js/'))built=await buildJs(source);
  if(built){html=html.replace(tag,tag.replace(url,built));pageAssets.push(built);}
 }
 // No third-party handshake is needed to load the vendored account SDK.
 html=html.replace(/\s*<link rel="preconnect" href="https:\/\/cdn.jsdelivr.net" crossorigin>/g,'');
 let supabaseHint=false;html=html.replace(/<link rel="preconnect" href="https:\/\/xspzmthygrajzktydvvj.supabase.co" crossorigin>/g,tag=>{if(supabaseHint)return '';supabaseHint=true;return tag;});
 html=html.replace(/(<link\b[^>]+>)[ \t\r\n]+(?=<)/g,'$1\n');
 await writeFile(page,html);manifest.pages[page]=pageAssets;manifest.pageHashes[page]=hash(html);
}
// Include dynamically loaded dependencies in the offline core's dependency closure.
const closure=async seed=>{const found=new Set(seed),queue=[...seed];while(queue.length){const file=queue.shift();if(!/\.(?:js|css)$/.test(file))continue;const text=await read(file);for(const item of text.match(/assets\/dist\/[\w.-]+\.(?:js|css)/g)||[])if(!found.has(item)){found.add(item);queue.push(item);}}return [...found];};
const corePages=['index.html','scoring.html','hole-view.html'];
const coreAssets=await closure(corePages.flatMap(page=>manifest.pages[page]));
// Optional admin tools are excluded even though they are conditionally referenced by the client.
const adminSources=['course-view-guided-setup','scorecard-workflow-fix','test-event-controls','event-course-setup','admin-brilliant','admin-scorecard-preview','admin-member-golf-settings'];
const unusedStyles=['deep-teal-theme','product-premium','mobile-redesign','brilliant','matchday-redesign','personal-theme'];
const declaredCore=new Set(corePages.flatMap(page=>manifest.pages[page]));
const core=coreAssets.filter(file=>declaredCore.has(file)||!adminSources.some(name=>file.startsWith(out+'/'+name+'.'))&&!unusedStyles.some(name=>file.startsWith(out+'/'+name+'.')&&file.endsWith('.css')));
const template=await read('scripts/service-worker.template.js');
manifest.build=hash(JSON.stringify(manifest)+template);
await writeFile('sw.js',template.replace('__RELEASE__',release+'-'+manifest.build).replace('__PAGES__',JSON.stringify(Object.keys(manifest.pages))).replace('__CORE__',JSON.stringify([...corePages,...core,'manifest.webmanifest','assets/images/barford-golf-society-logo-320.webp'])));
await writeFile('assets/asset-manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(`Built ${Object.keys(manifest.pages).length} pages; ${core.length} core assets. Release ${release}.`);
