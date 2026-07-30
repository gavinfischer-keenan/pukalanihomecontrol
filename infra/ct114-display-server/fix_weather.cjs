const fs = require('fs');
const p = '/opt/display-server/src/components/WeatherView.jsx';
let c = fs.readFileSync(p, 'utf8');
c = c.replace(/\\`/g, '`').replace(/\\\$/g, '$');
fs.writeFileSync(p, c);
