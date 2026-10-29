const { test, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Work on a temp copy of the data so tests never touch data/expenses.json
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'expenses-')), 'expenses.json');
fs.copyFileSync(path.join(__dirname, '..', 'data', 'expenses.json'), tmp);
process.env.EXPENSES_FILE = tmp;

const app = require('../src/app');
const server = app.listen(0);
after(() => server.close());

function request(method, urlPath, data) {
  return new Promise((resolve, reject) => {
    const payload = data === undefined ? null : JSON.stringify(data);
    const req = http.request(
      {
        port: server.address().port,
        path: urlPath,
        method,
        headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          const json = res.headers['content-type']?.includes('json') ? JSON.parse(body) : body;
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Data lines of a CSV body (header and trailing newline dropped)
function dataLines(body) {
  return body.split('\n').slice(1, -1);
}

test('GET /expenses/export.csv exports September with a header, sorted by date', async () => {
  const res = await request('GET', '/expenses/export.csv?from=2026-09-01&to=2026-09-30');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers['content-type'], 'text/csv; charset=utf-8');
  assert.strictEqual(res.body.split('\n')[0], 'date,category,amount,note');
  const rows = dataLines(res.body);
  assert.strictEqual(rows.length, 18);
  const dates = rows.map((l) => l.slice(0, 10));
  assert.deepStrictEqual(dates, [...dates].sort());
  assert.ok(dates.every((d) => d >= '2026-09-01' && d <= '2026-09-30'));
});

test('GET /expenses/export.csv quotes a note that contains a comma', async () => {
  const res = await request('GET', '/expenses/export.csv?from=2026-09-05&to=2026-09-05');
  assert.deepStrictEqual(dataLines(res.body), ['2026-09-05,food,700,"Groceries: rice, dal, oil"']);
});

test('GET /expenses/export.csv doubles a double quote inside a note', async () => {
  const add = await request('POST', '/expenses', { date: '2027-01-10', amount: 50, category: 'food', note: 'She said "hi"' });
  assert.strictEqual(add.status, 201);
  const res = await request('GET', '/expenses/export.csv?from=2027-01-10&to=2027-01-10');
  assert.deepStrictEqual(dataLines(res.body), ['2027-01-10,food,50,"She said ""hi"""']);
});

test('GET /expenses/export.csv rejects missing, invalid or reversed dates with 400', async () => {
  const cases = [
    '?to=2026-09-30',
    '?from=2026-09-01',
    '?from=2026-9-1&to=2026-09-30',
    '?from=2026-02-01&to=2026-02-30',
    '?from=2026-09-30&to=2026-09-01',
  ];
  for (const q of cases) {
    const res = await request('GET', '/expenses/export.csv' + q);
    assert.strictEqual(res.status, 400, q);
    assert.ok(typeof res.body.error === 'string' && res.body.error.length > 0, q);
  }
});

test('GET /expenses/export.csv sets a Content-Disposition filename from the range', async () => {
  const res = await request('GET', '/expenses/export.csv?from=2026-09-01&to=2026-09-30');
  assert.strictEqual(res.headers['content-disposition'], 'attachment; filename="expenses-2026-09-01-2026-09-30.csv"');
});

test('GET /expenses/export.csv returns only the header for an empty range', async () => {
  const res = await request('GET', '/expenses/export.csv?from=2030-01-01&to=2030-01-31');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body, 'date,category,amount,note\n');
});

test('GET /expenses/export.csv includes both ends of the range', async () => {
  const res = await request('GET', '/expenses/export.csv?from=2026-09-03&to=2026-09-03');
  assert.strictEqual(dataLines(res.body).length, 2);
});
