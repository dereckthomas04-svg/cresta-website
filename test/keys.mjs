import fs from 'node:fs';
const L={};for(const l of ['en','es','fr','pt','de'])L[l]=(await import(`../public/js/i18n-${l}.js`)).default;
const en=Object.keys(L.en);
for(const l of ['es','fr','pt','de']){const k=Object.keys(L[l]);console.log(l,'missing',en.filter(x=>!k.includes(x)),'extra',k.filter(x=>!en.includes(x)));}
const html=fs.readFileSync('public/index.html','utf8');
const used=[...html.matchAll(/data-i18n(?:-ph)?="([^"]+)"/g)].map(m=>m[1]);
console.log('html missing',[...new Set(used.filter(k=>!(k in L.en)))]);
console.log('count',en.length);
