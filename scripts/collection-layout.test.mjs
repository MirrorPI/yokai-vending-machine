import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionLayout } from '../src/app/collection-layout.ts';

test('small floating window fits the map and keeps the banner compact',()=>{
 const r=collectionLayout(288,488);
 assert.equal(r.scene.scale,1.5);assert.equal(r.scene.left,0);assert.equal(r.scene.top,0);
 assert.equal(r.footerHeight,74);assert.equal(r.docked,false);
});
test('resizing fits the full scene and footer while keeping layers on the browser pixel grid',()=>{
 for(const [w,h] of [[192,320],[256,384],[384,576],[510,760],[800,900],[1440,400]]){
  const r=collectionLayout(w,h),s=r.scene;
  assert.equal(s.scale*64,Math.round(s.scale*64));
  assert.ok(s.left>=0&&s.top>=0);
  assert.ok(s.left+192*s.scale<=w);
  assert.ok(s.top+256*s.scale+r.footerHeight<=h);
  assert.ok(r.footerHeight>=74);
 }
});
test('wide windows retain both side panels and reserve a visible banner below the map',()=>{
 for(const [w,h] of [[1100,768],[1200,900],[1440,900],[2560,1440]]){
  const {docked,panelWidth,scene,footerHeight}=collectionLayout(w,h);
  assert.equal(docked,true);assert.equal(scene.top,16);assert.equal(scene.scale,2);assert.equal(footerHeight,74);
  assert.ok(panelWidth>=240&&panelWidth<=320);
  assert.ok(scene.left-panelWidth-16>=16);
  assert.ok(scene.left+192*scene.scale+16+panelWidth<=w-16);
 }
});

test('a shorter banner gives height-limited windows more room for the map',()=>{
 const {scene,footerHeight}=collectionLayout(384,500);
 assert.equal(scene.scale,1.65625);
 assert.equal(footerHeight,74);
 assert.ok(scene.top+scene.scale*256+footerHeight<=500);
});
