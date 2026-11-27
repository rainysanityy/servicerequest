// Container-Healthcheck ohne Shell/curl (distroless): prüft /api/health/ready
import http from 'node:http';

const req = http.get(
  { host: '127.0.0.1', port: Number(process.env['PORT'] ?? 3000), path: '/api/health/ready', timeout: 3000 },
  (res) => process.exit(res.statusCode === 200 ? 0 : 1),
);
req.on('error', () => process.exit(1));
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
