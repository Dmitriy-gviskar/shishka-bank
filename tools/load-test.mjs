// Нагрузочное тестирование Шишка Банк.
// Запуск: npx autocannon -c 30 -d 30 -m POST -H "Content-Type=application/json" -b '{"code":"TEST01"}' http://VPS:3777/api/link
// Или: node tools/load-test.mjs
const autocannon = require('autocannon');

const URL = process.env.TEST_URL || 'http://127.0.0.1:3777';

const scenarios = [
  { name: 'ping (GET)',        url: '/api/ping' },
  { name: 'state (GET)',       url: '/api/state',    headers: { 'x-child-code': process.env.TEST_CODE || 'TEST01' } },
  { name: 'tasks (GET)',       url: '/api/tasks',    headers: { 'x-child-code': process.env.TEST_CODE || 'TEST01' } },
  { name: 'link (POST)',       url: '/api/link',     method: 'POST', body: JSON.stringify({ code: 'ZZZZZZ' }), headers: { 'Content-Type': 'application/json' } },
  { name: 'static index.html', url: '/' },
];

async function run() {
  for (const s of scenarios) {
    const opts = { url: URL + s.url, connections: 30, duration: 10, method: s.method || 'GET', headers: s.headers || {}, body: s.body };
    console.log(`\n=== ${s.name} ===`);
    const result = await autocannon(opts);
    console.log(`  Req/sec: ${result.requests.average} | Latency avg: ${result.latency.average}ms | p99: ${result.latency.p99}ms | Errors: ${result.errors}/${result.requests.total}`);
  }
}

run().catch(console.error);
