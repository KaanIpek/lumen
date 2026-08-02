#!/usr/bin/env node
/*
 * LUMEN — reference leaderboard server
 * -------------------------------------------------------------
 * A small, dependency-free Node server implementing the two
 * endpoints js/leaderboard.js expects. It is deliberately simple
 * and readable so you can port it to whatever you actually host
 * on (Workers, Lambda, Supabase, a $5 VPS).
 *
 *   node server/leaderboard-server.js            # :5190, ./data
 *   PORT=8080 DATA=/var/lib/lumen node server/leaderboard-server.js
 *
 * Endpoints
 *   GET  /top?board=daily|alltime&day=YYYY-MM-DD&limit=20
 *   POST /submit  {name, score, combo, board, day}
 *
 * What it does about cheating: nothing clever, and it says so.
 * A browser game cannot prove a score is real. This rate-limits
 * per IP, caps absurd values, and keeps one entry per name — enough
 * for a friendly board. If you need integrity, move scoring
 * server-side or sign runs; don't pretend a client number is trusted.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5190;
const DATA_DIR = process.env.DATA || path.join(__dirname, 'data');
const MAX_SCORE = 5000000;          // beyond this it's obviously fabricated
const RATE_WINDOW_MS = 60000;
const RATE_MAX = 20;                // submissions per IP per minute
const KEEP_PER_BOARD = 100;

fs.mkdirSync(DATA_DIR, { recursive: true });

const rate = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const hits = (rate.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rate.set(ip, hits);
  return hits.length > RATE_MAX;
}

const fileFor = (board, day) =>
  path.join(DATA_DIR, board === 'daily' ? 'daily-' + (day || 'unknown') + '.json' : 'alltime.json');

function load(file) {
  try { const a = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}
function save(file, rows) {
  try { fs.writeFileSync(file, JSON.stringify(rows)); } catch (e) { console.error('save failed', e.message); }
}

const cleanName = (n) =>
  String(n || 'anon').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'anon';

function send(res, code, body) {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(s);
}

const server = http.createServer((req, res) => {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') return send(res, 204, {});

  if (req.method === 'GET' && url.pathname === '/top') {
    const board = url.searchParams.get('board') === 'daily' ? 'daily' : 'alltime';
    const day = url.searchParams.get('day') || '';
    const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 20, 100);
    const rows = load(fileFor(board, day)).slice(0, limit);
    return send(res, 200, { board, day, rows });
  }

  if (req.method === 'POST' && url.pathname === '/submit') {
    if (rateLimited(ip)) return send(res, 429, { error: 'slow down' });
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 4096) { req.destroy(); }   // no giant bodies
    });
    req.on('end', () => {
      let b;
      try { b = JSON.parse(raw); } catch (e) { return send(res, 400, { error: 'bad json' }); }
      const score = Math.floor(Number(b.score));
      if (!isFinite(score) || score <= 0 || score > MAX_SCORE) return send(res, 400, { error: 'bad score' });
      const board = b.board === 'daily' ? 'daily' : 'alltime';
      const day = String(b.day || '').slice(0, 10);
      const name = cleanName(b.name);
      const combo = Math.max(0, Math.min(9999, Math.floor(Number(b.combo) || 0)));

      const file = fileFor(board, day);
      const rows = load(file);
      // one entry per name: keep their best, so the board is people not attempts
      const existing = rows.findIndex((r) => r.name === name);
      if (existing >= 0) {
        if (rows[existing].score >= score) {
          return send(res, 200, { ok: true, rank: rows.findIndex((r) => r.name === name) + 1, rows: rows.slice(0, 20) });
        }
        rows.splice(existing, 1);
      }
      rows.push({ name, score, combo, at: Date.now() });
      rows.sort((a, z) => z.score - a.score);
      rows.length = Math.min(rows.length, KEEP_PER_BOARD);
      save(file, rows);
      const rank = rows.findIndex((r) => r.name === name && r.score === score) + 1;
      return send(res, 200, { ok: true, rank, rows: rows.slice(0, 20) });
    });
    return undefined;
  }

  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log('LUMEN leaderboard on http://localhost:' + PORT + '  (data: ' + DATA_DIR + ')');
  console.log('Point js/leaderboard.js `endpoint` at it, e.g.  LUMEN.Leaderboard.endpoint = "http://localhost:' + PORT + '"');
});
