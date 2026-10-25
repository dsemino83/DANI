import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => console.log(new Date().toISOString(), 'zap-baseline', ...args);

const enabled = String(process.env.ZAP_ENABLED || 'false').toLowerCase() === 'true';
if (!enabled) {
  log('disabled');
  process.exit(0);
}

const target = process.env.ZAP_TARGET_URL?.trim();
const stagingHost = process.env.ZAP_STAGING_HOST?.trim();
const zapUrl = (process.env.ZAP_URL || 'http://zap:8080').replace(/\/$/, '');
const apiKeyFile = process.env.ZAP_API_KEY_FILE || '/run/secrets/zap_api_key';
const reportDir = process.env.ZAP_REPORT_DIR || '/tmp/zap-reports';
const maxMinutes = Number(process.env.ZAP_MAX_MINUTES || '5');
const spiderMinutes = Number(process.env.ZAP_SPIDER_MINUTES || '1');

if (!target || !stagingHost) throw new Error('ZAP_TARGET_URL y ZAP_STAGING_HOST son obligatorios cuando ZAP_ENABLED=true');

const parsed = new URL(target);
if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('ZAP_TARGET_URL debe usar http o https');
if (parsed.hostname !== stagingHost) {
  throw new Error(`ZAP_TARGET_URL apunta a ${parsed.hostname}, pero ZAP_STAGING_HOST exige ${stagingHost}`);
}

const apiKey = (await readFile(apiKeyFile, 'utf8')).trim();
if (!apiKey) throw new Error('La llave de ZAP está vacía');

const api = async (format, component, operation, name, params = {}, timeoutMs = 15000) => {
  const query = new URLSearchParams({ apikey: apiKey, ...Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
  )});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${zapUrl}/${format}/${component}/${operation}/${name}/?${query}`, { signal: controller.signal });
    const body = await response.text();
    if (!response.ok) throw new Error(`ZAP HTTP ${response.status}: ${body.slice(0, 500)}`);
    return format === 'JSON' ? JSON.parse(body) : body;
  } finally {
    clearTimeout(timer);
  }
};

await mkdir(reportDir, { recursive: true });

log('starting', JSON.stringify({ target, spiderMinutes, maxMinutes }));

await api('JSON', 'core', 'action', 'newSession', {
  name: `nightly-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  overwrite: 'true'
});

const started = await api('JSON', 'spider', 'action', 'scan', {
  url: target,
  recurse: 'true',
  subtreeOnly: 'true',
  maxChildren: 0
});

const scanId = started.scan;
if (scanId === undefined) throw new Error(`ZAP no devolvió scanId: ${JSON.stringify(started)}`);

const deadline = Date.now() + maxMinutes * 60_000;
let status = '0';
while (Date.now() < deadline) {
  const result = await api('JSON', 'spider', 'view', 'status', { scanId });
  status = String(result.status ?? '0');
  if (Number(status) >= 100) break;
  await sleep(2000);
}

if (Number(status) < 100) {
  await api('JSON', 'spider', 'action', 'stop', { scanId }).catch(() => {});
  throw new Error(`El spider excedió el límite de ${maxMinutes} minutos`);
}

const passiveDeadline = Date.now() + Math.max(1, maxMinutes - spiderMinutes) * 60_000;
let remaining = -1;
while (Date.now() < passiveDeadline) {
  const result = await api('JSON', 'pscan', 'view', 'recordsToScan');
  remaining = Number(result.recordsToScan ?? 0);
  if (remaining === 0) break;
  await sleep(2000);
}

if (remaining !== 0) {
  log('passive-timeout', JSON.stringify({ remaining }));
}

const alerts = await api('JSON', 'core', 'view', 'alerts', {
  baseurl: target,
  start: 0,
  count: 5000
});

const rows = Array.isArray(alerts.alerts) ? alerts.alerts : [];
const summary = rows.reduce((acc, alert) => {
  const risk = String(alert.riskdesc || alert.risk || 'Informational');
  acc[risk] = (acc[risk] || 0) + 1;
  return acc;
}, {});

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const report = {
  fecha: new Date().toISOString(),
  target,
  spider: { scanId, status: Number(status) },
  passiveRecordsRemaining: remaining,
  totalAlerts: rows.length,
  byRisk: summary,
  alerts: rows.map(({ alertRef, pluginId, name, riskdesc, confidence, url, method, param, description, solution }) => ({
    alertRef, pluginId, name, riskdesc, confidence, url, method, param, description, solution
  }))
};

const jsonPath = `${reportDir}/zap-baseline-${stamp}.json`;
await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');

log('completed', JSON.stringify({
  target,
  totalAlerts: rows.length,
  byRisk: summary,
  report: basename(jsonPath)
}));
