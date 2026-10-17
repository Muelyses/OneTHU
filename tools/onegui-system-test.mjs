/** OneGUI system invariants: real theme lifecycle and readable semantic pairs.
 * Run: node --import ./tools/ts-resolve-register.mjs tools/onegui-system-test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { StyleDirector, resolveScopeDecl } from '../packages/gui/src/pipeline/director.ts';
import { parseColor, contrast, over } from '../packages/gui/src/pipeline/color.ts';

// A scope's identity mappings must inherit rather than invalidate the variable.
// This is used by onboarding and attachment sheets, not just the gallery.
for (const key of ['surface-overlay', 'surface-1', 'content-1', 'content-2', 'content-3', 'line-1']) {
  assert.equal(resolveScopeDecl(key, key), null, `${key}: a CSS variable cannot reference itself`);
}
assert.match(resolveScopeDecl('surface-1', 'surface-overlay'), /--og-surface-overlay/);
assert.equal(resolveScopeDecl('content-1', 'url(unsafe)'), null);

// Exercise the production director: custom accent -> dark -> default -> light.
const values = new Map();
const root = { dataset: {}, style: { setProperty: (k,v) => values.set(k,v), removeProperty: k => values.delete(k) } };
const director = new StyleDirector();
director.mount(root, { storage: null, prefersDark: () => false });
assert.equal(values.size, 0, 'default colors come from semantic CSS');
director.set({ theme: { id:'test', accent:'#2865a8' } });
assert.ok(values.has('--og-selected'));
assert.ok(values.has('--og-accent-inverse'));
assert.ok(!values.has('--og-action'), 'a user accent must never overwrite the primary action');
director.set({ scheme:'dark' });
assert.equal(root.dataset.ogScheme, 'dark');
director.set({ theme:null, scheme:'light' });
assert.equal(values.size, 0, 'returning to default clears ALL derived accent values');

// Read actual CSS, so a later palette edit cannot silently break contrast.
const read = p => readFileSync(new URL('../packages/gui/src/'+p, import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
const refs=read('tokens/reference.css'), semantic=read('tokens/semantic.css');
const declarations = text => Object.fromEntries([...text.matchAll(/(--og-[\w-]+)\s*:\s*([^;]+);/g)].map(m=>[m[1],m[2].trim()]));
const split=semantic.indexOf('[data-og-scheme="dark"]');
const light={...declarations(refs),...declarations(semantic.slice(0,split))};
const dark={...light,...declarations(semantic.slice(split))};
let pairs=0;
for(const [name,tokens] of Object.entries({light,dark})){
 const resolve=(k,seen=new Set())=>{assert.ok(!seen.has(k),`cycle at ${k}`);seen.add(k);const v=tokens[k];assert.ok(v,`missing ${k}`);const m=/^var\((--og-[\w-]+)\)$/.exec(v);return m?resolve(m[1],seen):v;};
 const color=k=>{const c=parseColor(resolve(k));assert.ok(c,`${name} ${k} is not a color`);return c;};
 const check=(fg,bg)=>{const background=over(color(bg),color("--og-surface-1"));const ratio=contrast(over(color(fg),background),background);assert.ok(ratio>=4.5,`${name} ${fg} on ${bg}: ${ratio.toFixed(2)} <4.5`);pairs++;};
 check('--og-action-on','--og-action');
 for(const bg of ['--og-surface-0','--og-surface-1','--og-surface-overlay'])
  for(const fg of ['--og-content-1','--og-content-2','--og-content-3'])check(fg,bg);
 for(const tone of ['error','warning','success','info'])check(`--og-${tone}`,`--og-${tone}-soft`);
}
console.log(`OneGUI system: scope inheritance ✓ theme round trip ✓ action/accent isolation ✓ ${pairs} semantic contrast pairs ✓`);
