const express = require('express');
const path = require('path');
const store = require('./store');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// "2026-09-05" and nothing else (rejects 2026-13-45, 2026-9-5, timestamps, ...)
function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isValidMonth(s) {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: require('../package.json').version });
});

// GET /expenses?from=YYYY-MM-DD&to=YYYY-MM-DD&category=food  (all optional, range inclusive)
app.get('/expenses', (req, res) => {
  const { from, to, category } = req.query;
  let rows = store.readAll();
  if (from) rows = rows.filter((r) => r.date >= from);
  if (to) rows = rows.filter((r) => r.date <= to);
  if (category) rows = rows.filter((r) => r.category === category);
  res.json(rows);
});

// GET /expenses/summary?month=YYYY-MM  -> { month, total, byCategory }
app.get('/expenses/summary', (req, res) => {
  const { month } = req.query;
  if (!isValidMonth(month)) {
    return res.status(400).json({ error: 'month must be YYYY-MM' });
  }
  const rows = store.readAll().filter((r) => r.date.startsWith(month + '-'));
  const byCategory = {};
  let total = 0;
  for (const r of rows) {
    total += r.amount;
    byCategory[r.category] = (byCategory[r.category] || 0) + r.amount;
  }
  res.json({ month, total, byCategory });
});

// POST /expenses  { date, amount, category, note? }
app.post('/expenses', (req, res) => {
  const body = req.body || {};
  const errors = [];
  if (!isValidDate(body.date)) errors.push('date must be YYYY-MM-DD');
  if (typeof body.amount !== 'number' || !(body.amount > 0)) errors.push('amount must be a number > 0');
  if (typeof body.category !== 'string' || body.category.trim() === '') errors.push('category is required');
  if (errors.length) {
    return res.status(400).json({ error: errors.join('; ') });
  }
  const row = store.add({
    date: body.date,
    category: body.category.trim(),
    amount: body.amount,
    note: typeof body.note === 'string' ? body.note : '',
  });
  res.status(201).json(row);
});

// Quote a CSV field if it holds a comma, a double quote or a line break
function csvField(s) {
  const v = String(s);
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

// GET /expenses/export.csv?from=YYYY-MM-DD&to=YYYY-MM-DD  (both required, range inclusive)
app.get('/expenses/export.csv', (req, res) => {
  const { from, to } = req.query;
  if (!isValidDate(from)) return res.status(400).json({ error: 'from must be YYYY-MM-DD' });
  if (!isValidDate(to)) return res.status(400).json({ error: 'to must be YYYY-MM-DD' });
  if (from > to) return res.status(400).json({ error: 'from must not be after to' });

  const rows = store
    .readAll()
    .filter((r) => r.date >= from && r.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
  const lines = ['date,category,amount,note'];
  for (const r of rows) lines.push([r.date, r.category, r.amount, csvField(r.note ?? '')].join(','));

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="expenses-${from}-${to}.csv"`);
  res.send(lines.join('\n') + '\n');
});

// --- routes end ---

module.exports = app;
