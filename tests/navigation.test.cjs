const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function navigation(page='events.html') {
  const classes=new Set(),admin={hidden:true},home={textContent:''},links=['index.html','account.html','payments.html'].map(href=>({getAttribute:()=>href,textContent:''})),listeners={};
  const context={location:{pathname:'/golf/'+page},document:{body:{classList:{toggle(name,on){on?classes.add(name):classes.delete(name);}}},querySelectorAll(selector){if(selector==='.header-admin-link')return [admin];if(selector==='.desktop-primary a,.site-nav a')return links;if(selector.includes('span:last-child'))return [home];return [];}},window:{addEventListener(name,handler){listeners[name]=handler;}}};
  vm.createContext(context);vm.runInContext(read('assets/js/site-navigation.js'),context);
  return {api:context.window.BarfordNavigation,admin,home,links,classes,listeners};
}
test('admin header is visible only with both a session and a verified boolean admin role',()=>{
  const h=navigation();
  for(const value of [null,{session:{user:{id:'member'}},profile:{is_admin:false}},{session:null,profile:{is_admin:true}},{session:{},profile:{is_admin:'true'}}]){h.api.setContext(value);assert.equal(h.admin.hidden,true);assert.equal(h.classes.has('is-admin'),false);}
  h.api.setContext({session:{user:{id:'admin'}},profile:{is_admin:true}});assert.equal(h.admin.hidden,false);assert.equal(h.classes.has('is-admin'),true);assert.equal(h.home.textContent,'Dashboard');
  h.listeners['barford-member-context']({detail:{session:null,profile:null}});assert.equal(h.admin.hidden,true);assert.equal(h.home.textContent,'Home');assert.equal(h.links[1].textContent,'Sign in');
});
test('event and signup screens highlight their parent; unrelated pages do not highlight Events',()=>{
  assert.equal(navigation('event.html').api.activePage,'events.html');assert.equal(navigation('signup.html').api.activePage,'account.html');assert.equal(navigation('payments.html').api.activePage,'payments.html');
});
test('every standard header loads shared navigation and authenticated role checking',()=>{
  for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.html'))){const html=read(file);if(!html.includes('site-header'))continue;assert.match(html,/site-navigation\./,file);assert.match(html,/supabase-client\./,file);assert.match(html,/supabase-2\./,file);}
});
test('internal page links point to existing pages, including paths generated in scripts',()=>{
  const files=[...fs.readdirSync(root).filter(f=>f.endsWith('.html')),...fs.readdirSync(path.join(root,'assets/js')).filter(f=>f.endsWith('.js')).map(f=>'assets/js/'+f)];
  const missing=[];
  for(const file of files)for(const match of read(file).matchAll(/(?:href\s*=\s*["']|location\.href\s*=\s*["'`])([a-zA-Z0-9_-]+\.html)/g))if(!fs.existsSync(path.join(root,match[1])))missing.push(file+': '+match[1]);
  assert.deepEqual(missing,[]);
});
