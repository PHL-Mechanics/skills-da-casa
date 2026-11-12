import fs from 'node:fs';
import path from 'node:path';

export const SEVERITIES = ['alto', 'medio', 'baixo'];
export const SEVERITY_LABEL = { alto: 'Alto', medio: 'Médio', baixo: 'Baixo' };

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}

export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function slugifyRoute(route) {
  if (!route || route === '/') return 'home';
  return route
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'rota';
}

export function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export function formatMs(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m} min ${s} s`;
}

export function median(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

export function tailLines(text, n = 60) {
  const lines = String(text || '').split(/\r?\n/);
  return lines.slice(-n).join('\n');
}

export function isLocalUrl(url) {
  try {
    const { hostname } = new URL(url);
    return ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(hostname) || hostname.endsWith('.local');
  } catch {
    return false;
  }
}

export function joinUrl(baseUrl, route) {
  const base = baseUrl.replace(/\/+$/, '');
  const r = route.startsWith('/') ? route : `/${route}`;
  return `${base}${r}`;
}

export function toPosix(p) {
  return p.split(path.sep).join('/');
}

export async function withTimeout(promise, ms, label = 'operação') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout de ${formatMs(ms)} em: ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

export function patternToRegex(pattern) {
  if (pattern instanceof RegExp) return pattern;
  const str = String(pattern);
  if (str.startsWith('re:')) return new RegExp(str.slice(3), 'i');
  const escaped = str.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

export function matchesAny(value, patterns = []) {
  return patterns.some((p) => patternToRegex(p).test(value));
}

export function containsAny(value, needles = []) {
  const v = String(value || '').toLowerCase();
  return needles.some((n) => {
    const s = String(n);
    if (s.startsWith('re:')) return new RegExp(s.slice(3), 'i').test(value);
    return v.includes(s.toLowerCase());
  });
}

export function createLogger(logFile) {
  const stream = logFile ? fs.createWriteStream(logFile, { flags: 'a' }) : null;
  const write = (level, msg) => {
    const line = `[${new Date().toISOString()}] ${level} ${msg}`;
    if (stream) stream.write(line + '\n');
    const prefix = { info: '•', ok: '✓', warn: '!', error: '✗', step: '→' }[level] || '•';
    const out = level === 'error' ? console.error : console.log;
    out(msg ? `${prefix} ${msg}` : '');
  };
  return {
    info: (m) => write('info', m),
    ok: (m) => write('ok', m),
    warn: (m) => write('warn', m),
    error: (m) => write('error', m),
    step: (m) => write('step', m),
    close: () => new Promise((resolve) => (stream ? stream.end(resolve) : resolve())),
  };
}

export async function settlePage(page, { idleMs = 5000 } = {}) {
  await page.waitForLoadState('networkidle', { timeout: idleMs }).catch(() => {});
  await page
    .evaluate(() => Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise((r) => setTimeout(r, 3000))]))
    .catch(() => {});
}

export async function autoScroll(page) {
  await page
    .evaluate(async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
      const max = () => document.documentElement.scrollHeight;
      let y = 0;
      for (let i = 0; i < 80 && y < max(); i++) {
        y += step;
        window.scrollTo(0, y);
        await delay(110);
      }
      window.scrollTo(0, max());
      await delay(350);
      window.scrollTo(0, 0);
      await delay(350);
    })
    .catch(() => {});
}
