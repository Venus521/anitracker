const fs = require('fs');
const path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const m = [...h.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)];
let bad = 0;
m.forEach((x, i) => {
  try { new Function(x[1]); console.log('block', i, 'OK len', x[1].length); }
  catch (e) { bad++; console.log('block', i, 'FAIL', e.message); }
});
process.exit(bad ? 1 : 0);
