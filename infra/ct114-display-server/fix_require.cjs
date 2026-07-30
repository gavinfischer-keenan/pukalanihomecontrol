const fs = require('fs');
const p = '/opt/display-server/server.js';
let c = fs.readFileSync(p, 'utf8');
c = c.replace(/require\('fs'\)\./g, '');
fs.writeFileSync(p, c);
