import { KIND_LABEL, scanText, scanUrl } from '../lib/lgpd-patterns.mjs';
import { joinUrl, settlePage } from '../lib/util.mjs';
import { attachObserver, createObservations, snapshotStorage } from './functional.mjs';

async function collectIfNeeded(ctx) {
  if (ctx.observations) return ctx.observations;
  const { browser, baseUrl, routes, config, target, log } = ctx;
  log.info('LGPD rodando sem a camada funcional: coletando requests, console e storage');
  const observations = createObservations();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: target === 'local' });
  const page = await context.newPage();
  let current = '/';
  attachObserver(page, observations, () => current);
  for (const route of routes) {
    current = route;
    try {
      await page.goto(joinUrl(baseUrl, route), { waitUntil: 'load', timeout: config.timeouts.navigationMs });
      await settlePage(page);
      await snapshotStorage(page, route, observations);
    } catch {
      // rota com erro: funcional reporta quando roda
    }
  }
  try {
    observations.cookies.push(...(await context.cookies()).map((c) => ({ route: '*', name: c.name, value: c.value, domain: c.domain })));
  } catch {
    // ignora
  }
  await context.close();
  ctx.observations = observations;
  return observations;
}

export async function runLgpd(ctx) {
  const { baseUrl, config, findings } = ctx;
  const observations = await collectIfNeeded(ctx);
  const allowlist = config.lgpd.allowlist || [];
  const origin = new URL(baseUrl).origin;
  const seenUrls = new Set();
  let scanned = 0;

  // 1. URLs de requests (inclui terceiros: analytics, pixels, APIs)
  for (const req of observations.requests) {
    if (seenUrls.has(req.url)) continue;
    seenUrls.add(req.url);
    scanned++;
    const { hits, maskedUrl } = scanUrl(req.url, { allowlist });
    if (!hits.length) continue;
    let host = '';
    try {
      host = new URL(req.url).host;
    } catch {
      host = '?';
    }
    const thirdParty = !req.url.startsWith(origin);
    const kinds = [...new Set(hits.map((h) => h.kind))];
    const onlySecret = kinds.every((k) => k === 'segredo');
    findings.add({
      layer: 'lgpd',
      severity: onlySecret ? 'medio' : 'alto',
      title: onlySecret
        ? `Token ou segredo em URL${thirdParty ? ' enviada a terceiro' : ''}`
        : `Dado pessoal em URL${thirdParty ? ' enviada a terceiro' : ''}`,
      detail: `${kinds.map((k) => KIND_LABEL[k]).join(', ')} em ${hits.map((h) => (h.key ? `parâmetro "${h.key}"` : h.where)).filter((v, i, a) => a.indexOf(v) === i).join(', ')}\nDestino: ${host}\nURL mascarada: ${maskedUrl}`,
      fix: thirdParty
        ? 'URL com dado pessoal fica em log de CDN, analytics e histórico. Envie no corpo de um POST para o seu backend e nunca repasse identificadores diretos para terceiros.'
        : 'Troque GET com dado pessoal por POST, ou use um ID opaco na URL. URL vai para log de servidor, Cloudflare e histórico do navegador.',
      route: req.route,
      groupKey: `${host}|${kinds.join(',')}|${hits.map((h) => h.key).join(',')}`,
    });
  }

  // 2. Console
  for (const msg of observations.console) {
    const hits = scanText(msg.text, { allowlist });
    if (!hits.length) continue;
    const kinds = [...new Set(hits.map((h) => h.kind))];
    findings.add({
      layer: 'lgpd',
      severity: 'medio',
      title: 'Dado pessoal impresso no console',
      detail: `${kinds.map((k) => KIND_LABEL[k]).join(', ')} em console.${msg.type} (${hits.map((h) => h.masked).slice(0, 3).join(', ')})`,
      fix: 'Remova console.log com dados de usuário. Ferramentas de monitoramento (Sentry, LogRocket) capturam o console.',
      route: msg.route,
      groupKey: `${msg.type}|${kinds.join(',')}`,
    });
  }

  // 3. localStorage / sessionStorage
  for (const snap of observations.storage) {
    for (const [area, entries] of [['localStorage', snap.local], ['sessionStorage', snap.session]]) {
      for (const [key, value] of entries || []) {
        const hits = scanText(`${key} ${value}`, { allowlist });
        if (!hits.length) continue;
        const kinds = [...new Set(hits.map((h) => h.kind))];
        findings.add({
          layer: 'lgpd',
          severity: 'medio',
          title: `Dado pessoal em ${area}`,
          detail: `Chave "${key}": ${kinds.map((k) => KIND_LABEL[k]).join(', ')} (${hits.map((h) => h.masked).slice(0, 2).join(', ')})`,
          fix: `${area} é legível por qualquer script da página (inclusive terceiros e XSS). Guarde só IDs opacos ou use cookie httpOnly.`,
          route: snap.route,
          groupKey: `${area}|${key}`,
        });
      }
    }
  }

  // 4. Cookies (valores visíveis ao contexto do navegador)
  const seenCookies = new Set();
  for (const c of observations.cookies) {
    const id = `${c.domain}|${c.name}`;
    if (seenCookies.has(id)) continue;
    seenCookies.add(id);
    let value = c.value;
    try {
      value = decodeURIComponent(c.value);
    } catch {
      // mantém bruto
    }
    const hits = scanText(value, { allowlist });
    if (!hits.length) continue;
    findings.add({
      layer: 'lgpd',
      severity: 'medio',
      title: 'Dado pessoal em cookie',
      detail: `Cookie "${c.name}" (${c.domain}): ${[...new Set(hits.map((h) => KIND_LABEL[h.kind]))].join(', ')}`,
      fix: 'Cookie viaja em todo request e aparece em logs. Use identificador opaco de sessão.',
      route: c.route === '*' ? undefined : c.route,
      groupKey: id,
    });
  }

  return {
    status: null,
    notes: [
      `${scanned} URL(s) únicas, ${observations.console.length} mensagem(ns) de console, ${observations.storage.length} snapshot(s) de storage e ${seenCookies.size} cookie(s) analisados.`,
      'Corpos de POST e o HTML das páginas não são varridos: contato público exibido na página não é vazamento.',
    ],
  };
}
