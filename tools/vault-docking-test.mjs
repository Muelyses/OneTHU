import assert from 'node:assert/strict';
import {commitVaultAnchor,resolveVaultAnchor} from '../apps/desktop/src/state/vaultAnchor.ts';
const b={left:6,right:384,top:70,bottom:760},w=64,h=48;
for(const side of ['left','right']){
 const p=commitVaultAnchor('phone',{left:side==='left'?6:320,top:320,side},b,w,h);assert.equal(p.docked,true);assert.equal(p.collapsed,true);
 const at=resolveVaultAnchor(p,b,w,h,[],8);const exposed=Math.min(at.left+w,390)-Math.max(at.left,0);assert.ok(exposed>=28&&exposed<w);
 const full=resolveVaultAnchor({...p,collapsed:false},b,w,h,[],8);assert.ok(full.left>=0&&full.left+w<=390);
 const obstructed=resolveVaultAnchor({...p,collapsed:false},b,w,h,[{left:0,right:390,top:70,bottom:760}],8);assert.equal(obstructed.side,side);
}
const free=commitVaultAnchor('phone',{left:160,top:300,side:'left'},b,w,h);assert.equal(free.collapsed,undefined);assert.equal(typeof free.xRatio,'number');assert.equal(resolveVaultAnchor(free,b,w,h,[],8).left,160);
const desktop=commitVaultAnchor('desktop',{left:6,top:320,side:'left'},b,w,h);assert.equal(desktop.collapsed,undefined);assert.equal(resolveVaultAnchor(desktop,b,w,h,[],8).left,6);
console.log('✓ phone edge docking, visible handles, receiving expansion, side retention, free placement and desktop behavior');
