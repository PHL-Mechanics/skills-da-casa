import fs from 'node:fs';
import path from 'node:path';
import { joinUrl, matchesAny } from './util.mjs';

const PAGE_FILE_RE = /^page\.(tsx|ts|jsx|js|mdx|md)$/;
const PAGES_EXT_RE = /\.(tsx|ts|jsx|js|mdx|md)$/;
const IGNORE_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'out', '.qa-runs']);

function walk(dir, visit) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else visit(full, entry.name);
  }
}

function discoverAppRouter(projectDir) {
  const routes = new Set();
  const dynamic = new Set();
  for (const base of ['app', path.join('src', 'app')]) {
    const root = path.join(projectDir, base);
    if (!fs.existsSync(root)) continue;
    walk(root, (full, name) => {
      if (!PAGE_FILE_RE.test(name)) return;
      const rel = path.relative(root, path.dirname(full));
      const segments = rel ? rel.split(path.sep) : [];
      if (segments.some((s) => s.startsWith('_') || s.startsWith('@') || /^\(\.+\)/.test(s))) return;
      const clean = segments.filter((s) => !(s.startsWith('(') && s.endsWith(')')));
      const route = '/' + clean.join('/');
      if (clean.some((s) => s.startsWith('['))) dynamic.add(route);
      else routes.add(route === '/' ? '/' : route.replace(/\/+$/, ''));
    });
  }
  return { routes, dynamic };
}

function discoverPagesRouter(projectDir) {
  const routes = new Set();
  const dynamic = new Set();
  for (const base of ['pages', path.join('src', 'pages')]) {
    const root = path.join(projectDir, base);
    if (!fs.existsSync(root)) continue;
    walk(root, (full, name) => {
      if (!PAGES_EXT_RE.test(name)) return;
      const rel = path.relative(root, full).replace(PAGES_EXT_RE, '');
      const segments = rel.split(path.sep);
      if (segments[0] === 'api' || segments.some((s) => s.startsWith('_'))) return;
      if (['404', '500'].includes(segments.join('/'))) return;
      if (segments[segments.length - 1] === 'index') segments.pop();
      const route = '/' + segments.join('/');
      if (segments.some((s) => s.startsWith('['))) dynamic.add(route);
      else routes.add(route);
    });
  }
  return { routes, dynamic };
}

async function fetchText(url, timeoutMs = 15000) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return null;
  return await res.text();
}

async function discoverSitemap(baseUrl) {
  const routes = new Set();
  const locsOf = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].trim());
  try {
    const root = await fetchText(joinUrl(baseUrl, '/sitemap.xml'));
    if (!root) return routes;
    let locs = locsOf(root);
    const children = locs.filter((l) => /\.xml(\?|$)/i.test(l)).slice(0, 5);
    if (children.length) {
      locs = locs.filter((l) => !/\.xml(\?|$)/i.test(l));
      for (const child of children) {
        try {
          const childPath = new URL(child).pathname;
          const xml = await fetchText(joinUrl(baseUrl, childPath));
          if (xml) locs.push(...locsOf(xml));
        } catch {
          // sitemap filho inacessível: ignora
        }
      }
    }
    for (const loc of locs) {
      try {
        const u = new URL(loc);
        routes.add(u.pathname.replace(/\/+$/, '') || '/');
      } catch {
        // loc inválido
      }
    }
  } catch {
    // sem sitemap
  }
  return routes;
}

async function discoverCrawl(browser, baseUrl, timeoutMs) {
  const routes = new Set(['/']);
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  try {
    await page.goto(joinUrl(baseUrl, '/'), { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const origin = new URL(baseUrl).origin;
    const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.href));
    for (const href of hrefs) {
      try {
        const u = new URL(href);
        if (u.origin !== origin) continue;
        if (/\.(pdf|jpg|jpeg|png|webp|zip|svg|mp4|xml|txt)$/i.test(u.pathname)) continue;
        routes.add(u.pathname.replace(/\/+$/, '') || '/');
      } catch {
        // href inválido
      }
    }
  } catch {
    // home inacessível: a camada funcional reporta
  } finally {
    await context.close();
  }
  return routes;
}

function sortRoutes(routes) {
  return [...routes].sort((a, b) => {
    if (a === '/') return -1;
    if (b === '/') return 1;
    const da = a.split('/').length;
    const db = b.split('/').length;
    return da - db || a.localeCompare(b);
  });
}

export async function discoverRoutes({ projectDir, baseUrl, config, target, browser, onlyRoutes, log }) {
  const notes = [];
  const dynamicSkipped = [];
  let source = 'config';
  let found = new Set();

  if (onlyRoutes?.length) {
    return { routes: onlyRoutes, source: '--routes', notes, dynamicSkipped };
  }

  if (config.routes.discover) {
    if (target === 'local') {
      const app = discoverAppRouter(projectDir);
      const pages = discoverPagesRouter(projectDir);
      found = new Set([...app.routes, ...pages.routes]);
      dynamicSkipped.push(...app.dynamic, ...pages.dynamic);
      if (found.size) source = 'arquivos do Next (app/pages)';
    }
    if (!found.size) {
      found = await discoverSitemap(baseUrl);
      if (found.size) source = 'sitemap.xml';
    }
    if (!found.size && browser) {
      found = await discoverCrawl(browser, baseUrl, config.timeouts.navigationMs);
      source = 'links da home';
    }
  }

  for (const r of config.routes.include || []) found.add(r.startsWith('/') ? r : `/${r}`);
  found.add('/');

  let routes = sortRoutes([...found].filter((r) => r === '/' || !matchesAny(r, config.routes.exclude || [])));
  const max = Number(config.routes.max) || 25;
  if (routes.length > max) {
    notes.push(`${routes.length} rotas encontradas; verificando as ${max} primeiras (routes.max). Use --routes para focar.`);
    routes = routes.slice(0, max);
  }
  if (dynamicSkipped.length) {
    notes.push(`Rotas dinâmicas sem exemplo foram puladas: ${dynamicSkipped.slice(0, 8).join(', ')}${dynamicSkipped.length > 8 ? '…' : ''}. Adicione exemplos reais em routes.include (ex.: "/blog/meu-post").`);
  }
  log?.info(`Rotas (${source}): ${routes.join(', ')}`);
  return { routes, source, notes, dynamicSkipped };
}
