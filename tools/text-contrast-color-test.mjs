import assert from 'node:assert/strict';
import {renderedColor} from '../apps/desktop/src/lib/textContrastColor.ts';
const samples=[
 ['color(srgb 1 0.5 0 / 0.3)',{rgb:[255,127.5,0],a:.3}],
 ['color(srgb 10% 20% 30% / 60%)',{rgb:[25.5,51,76.5],a:.6}],
 ['rgba(10, 20, 30, 0.74)',{rgb:[10,20,30],a:.74}],
 ['rgb(100% 0% 0% / 25%)',{rgb:[255,0,0],a:.25}],
 ['#fff',{rgb:[255,255,255],a:1}],['#1234',{rgb:[17,34,51],a:68/255}],
 ['#11223380',{rgb:[17,34,51],a:128/255}],['transparent',{rgb:[0,0,0],a:0}],
 ['rgb(500 -10 128 / 2)',{rgb:[255,0,128],a:1}],
 ['color(srgb 1 0)',null],['#12345',null],['rgb(NaN 0 0)',null],['red',null],['',null],
];
for(const [input,want] of samples)assert.deepEqual(renderedColor(input),want,input);
console.log(`${samples.length} computed color assertions passed`);
