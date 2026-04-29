const fs = require('fs');
const path = 'public/templates/investor-certificate-template.pdf';
const buf = fs.readFileSync(path);
const s = buf.toString('latin1');

const start = s.indexOf('7 0 obj');
if(start === -1) { 
  console.error('no object'); 
  process.exit(1);
}

const streamStart = s.indexOf('stream', start);
const streamEnd = s.indexOf('endstream', streamStart);

if(streamStart === -1 || streamEnd === -1) { 
  console.error('no stream'); 
  process.exit(1);
}

const dataStart = streamStart + 'stream'.length;
let offset = dataStart;

if(s.slice(offset, offset+2) === '\r\n') offset += 2;
if(s.slice(offset, offset+1) === '\n') offset += 1;

const img = buf.slice(offset, streamEnd);
fs.writeFileSync('public/templates/investor-certificate-template.jpg', img);
console.log('saved', img.length);
