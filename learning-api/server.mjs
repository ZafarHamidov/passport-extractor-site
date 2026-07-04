import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
const submissionsPath = join(dataDir, 'corrections.jsonl');
const curatedRulesPath = join(dataDir, 'rules.json');

const port = Number(process.env.PORT || 8787);
const minRuleSupport = Number(process.env.MIN_RULE_SUPPORT || 2);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const correctionFields = new Set([
  'passportNumber',
  'documentCode',
  'issuingState',
  'nationality',
  'lastName',
  'firstNames',
  'birthDate',
  'placeOfBirth',
  'dateOfIssue',
  'sex',
  'expirationDate',
  'personalNumber',
  'rawMrz',
]);

const safeExactRuleFields = new Set(['documentCode', 'issuingState', 'nationality', 'sex']);

function getCorsHeaders(origin = '') {
  const allowOrigin =
    allowedOrigins.includes('*') || !origin
      ? '*'
      : allowedOrigins.includes(origin)
        ? origin
        : allowedOrigins[0] || '*';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function sendJson(response, statusCode, payload, origin) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...getCorsHeaders(origin),
  });
  response.end(JSON.stringify(payload));
}

function sanitizeText(value, maxLength) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeValue(value) {
  return sanitizeText(value, 500).toUpperCase();
}

function stableId(parts) {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 18);
}

async function readBody(request, maxBytes = 24_000) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new Error('Payload too large');
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
}

function validateCorrection(input) {
  const field = sanitizeText(input.field, 40);
  const from = sanitizeText(input.from, field === 'rawMrz' ? 700 : 220);
  const to = sanitizeText(input.to, field === 'rawMrz' ? 700 : 220);

  if (!correctionFields.has(field)) {
    throw new Error('Unsupported correction field');
  }

  if (!from || !to || normalizeValue(from) === normalizeValue(to)) {
    throw new Error('Correction must include different from/to values');
  }

  return {
    version: 1,
    profileId: sanitizeText(input.profileId, 40) || 'GENERIC',
    profileName: sanitizeText(input.profileName, 80) || 'Generic TD3 passport',
    field,
    from,
    to,
    rawMrz: sanitizeText(input.rawMrz, 240),
    documentCode: sanitizeText(input.documentCode, 24),
    issuingState: sanitizeText(input.issuingState, 24),
    nationality: sanitizeText(input.nationality, 24),
    appVersion: sanitizeText(input.appVersion, 20),
    createdAt: sanitizeText(input.createdAt, 40) || new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  };
}

async function readJsonIfExists(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function readSubmissions() {
  try {
    const text = await readFile(submissionsPath, 'utf8');
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function getCuratedRules() {
  const rules = await readJsonIfExists(curatedRulesPath, { corrections: [] });
  return Array.isArray(rules.corrections) ? rules.corrections : [];
}

async function getAggregatedRules() {
  const grouped = new Map();

  for (const correction of await readSubmissions()) {
    if (!safeExactRuleFields.has(correction.field)) {
      continue;
    }

    const key = [
      correction.profileId,
      correction.field,
      normalizeValue(correction.from),
      normalizeValue(correction.to),
    ].join('|');
    const existing = grouped.get(key);

    if (existing) {
      existing.support += 1;
      existing.createdAt = Math.max(existing.createdAt, Date.parse(correction.receivedAt) || 0);
    } else {
      grouped.set(key, {
        id: `shared-${stableId([key])}`,
        profileId: correction.profileId,
        field: correction.field,
        from: correction.from,
        to: correction.to,
        createdAt: Date.parse(correction.receivedAt) || Date.now(),
        support: 1,
        source: 'shared',
      });
    }
  }

  return Array.from(grouped.values())
    .filter((rule) => rule.support >= minRuleSupport)
    .sort((a, b) => b.support - a.support)
    .slice(0, 500);
}

async function handleCorrections(request, response, origin) {
  const body = JSON.parse(await readBody(request));
  const inputCorrections = Array.isArray(body?.corrections) ? body.corrections : [];

  if (!inputCorrections.length || inputCorrections.length > 40) {
    sendJson(response, 400, { error: 'Submit between 1 and 40 corrections.' }, origin);
    return;
  }

  const corrections = inputCorrections.map(validateCorrection);
  await mkdir(dataDir, { recursive: true });
  await appendFile(submissionsPath, `${corrections.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');
  sendJson(response, 201, { ok: true, saved: corrections.length }, origin);
}

async function handleRules(_request, response, origin) {
  const [curatedRules, aggregatedRules] = await Promise.all([getCuratedRules(), getAggregatedRules()]);
  sendJson(
    response,
    200,
    {
      corrections: [...curatedRules, ...aggregatedRules].slice(0, 700),
      minRuleSupport,
      safeExactRuleFields: Array.from(safeExactRuleFields),
    },
    origin,
  );
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  const origin = request.headers.origin || '';

  if (request.method === 'OPTIONS') {
    response.writeHead(204, getCorsHeaders(origin));
    response.end();
    return;
  }

  try {
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true }, origin);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/rules') {
      await handleRules(request, response, origin);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/corrections') {
      await handleCorrections(request, response, origin);
      return;
    }

    sendJson(response, 404, { error: 'Not found' }, origin);
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : 'Request failed' }, origin);
  }
});

server.listen(port, () => {
  console.log(`Passport learning API listening on http://127.0.0.1:${port}`);
});
