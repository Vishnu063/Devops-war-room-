import { request } from 'node:http';
const origin = new URL(process.env.APP_ORIGIN || 'http://127.0.0.1:3100');
const req = request(
  'http://127.0.0.1:' + (process.env.PORT || 3100) + '/api/health',
  { headers: { Host: origin.host } },
  (res) => {
    let body = '';
    res.on('data', (b) => {
      body += b;
      if (body.length > 4096) req.destroy();
    });
    res.on('end', () => {
      try {
        if (res.statusCode !== 200 || JSON.parse(body).mode !== 'DATABASE') process.exitCode = 1;
      } catch {
        process.exitCode = 1;
      }
    });
  },
);
req.setTimeout(7500, () => req.destroy());
req.on('error', () => {
  process.exitCode = 1;
});
req.end();
