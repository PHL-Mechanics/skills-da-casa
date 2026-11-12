import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FLOWS_DIR } from '../lib/config.mjs';
import { ensureDir, joinUrl, mapLimit, settlePage, toPosix, withTimeout } from '../lib/util.mjs';

const DEFAULT_CONSOLE_NOISE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /\[HMR\]/i,
  /webpack-hmr/i,
  /Turbopack HMR/i,
];

export function createObservations() {
  return { requests: [], console: [], storage: [], cookies: [] };
}

export function attachObserver(page, observations, getRoute) {
  const errors = { console: [], pageErrors: [], failed: [], badResponses: [] };
  page.on('console', (msg) => {
    const text = msg.text();
    observations.console.push({ route: getRoute(), type: msg.type(), text });
    // "Failed to load resource" já vira achado de rede com URL e tipo; não duplica.
    if (msg.type() === 'error' && !/^Failed to load resource/i.test(text) && !DEFAULT_CONSOLE_NOISE.some((re) => re.test(text))) {
      errors.console.push({ route: getRoute(), text, location: msg.location()?.url || '' });
    }
  });
  page.on('pageerror', (err) => {
    errors.pageErrors.push({ route: getRoute(), text: `${err.name}: ${err.message}` });
  });
  page.on('request', (req) => {
    observations.requests.push({ route: getRoute(), url: req.url(), method: req.method(), resourceType: req.resourceType() });
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure()?.errorText || 'falha';
    if (/ERR_ABORTED|NS_BINDING_ABORTED/i.test(failure)) return;
    errors.failed.push({ route: getRoute(), url: req.url(), failure, resourceType: req.resourceType() });
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      errors.badResponses.push({ route: getRoute(), url: res.url(), status: res.status(), resourceType: res.request().resourceType() });
    }
  });
  return errors;
}

export async function snapshotStorage(page, route, observations) {
  try {
    const storage = await page.evaluate(() => {
      const dump = (s) => {
        const out = [];
        for (let i = 0; i < s.length; i++) {
          const key = s.key(i);
          out.push([key, String(s.getItem(key)).slice(0, 5000)]);
        }
        return out;
      };
      return { local: dump(window.localStorage), session: dump(window.sessionStorage) };
    });
    observations.storage.push({ route, ...storage });
  } catch {
    // storage indisponível (ex.: about:blank, iframe sandbox)
  }
}

function shortUrl(url, origin) {
  try {
    const u = new URL(url);
    const base = u.origin === origin ? u.pathname : `${u.host}${u.pathname}`;
    return base.length > 120 ? base.slice(0, 117) + '…' : base;
  } catch {
    return url.slice(0, 120);
  }
}

function discoverFlows(projectDir) {
  const dir = path.join(projectDir, FLOWS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(mjs|js)$/.test(f) && !f.startsWith('_'))
    .sort()
    .map((f) => ({ name: f.replace(/\.(mjs|js)$/, ''), file: path.join(dir, f) }));
}

function createAssert(page, timeout = 10000) {
  const toLocator = (target) => (typeof target === 'string' ? page.locator(target).first() : target);
  return {
    async visible(target, message) {
      try {
        await toLocator(target).waitFor({ state: 'visible', timeout });
      } catch {
        throw new Error(message || `Elemento não ficou visível: ${target}`);
      }
    },
    async hidden(target, message) {
      try {
        await toLocator(target).waitFor({ state: 'hidden', timeout });
      } catch {
        throw new Error(message || `Elemento continuou visível: ${target}`);
      }
    },
    async text(target, expected, message) {
      const loc = toLocator(target);
      const started = Date.now();
      let last = '';
      while (Date.now() - started < timeout) {
        last = (await loc.textContent({ timeout: 2000 }).catch(() => '')) || '';
        const ok = expected instanceof RegExp ? expected.test(last) : last.includes(expected);
        if (ok) return;
        await page.waitForTimeout(250);
      }
      throw new Error(message || `Texto esperado não apareceu (${expected}). Último texto: "${last.slice(0, 120)}"`);
    },
    async url(pattern, message) {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        const current = page.url();
        const ok = pattern instanceof RegExp ? pattern.test(current) : current.includes(pattern);
        if (ok) return;
        await page.waitForTimeout(250);
      }
      throw new Error(message || `URL não chegou em ${pattern}. Atual: ${new URL(page.url()).pathname}`);
    },
    async count(target, expected, message) {
      const loc = typeof target === 'string' ? page.locator(target) : target;
      const started = Date.now();
      let n = 0;
      while (Date.now() - started < timeout) {
        n = await loc.count();
        if (n === expected) return;
        await page.waitForTimeout(250);
      }
      throw new Error(message || `Esperava ${expected} elemento(s), encontrou ${n}.`);
    },
    ok(condition, message) {
      if (!condition) throw new Error(message || 'Condição falsa.');
    },
  };
}

async function runFlows(ctx, observations) {
  const { browser, projectDir, baseUrl, target, config, env, findings, runDir, log, productionLike } = ctx;
  const flows = discoverFlows(projectDir);
  if (!flows.length) return { ran: 0 };
  const shotsDir = ensureDir(path.join(runDir, 'flows'));
  let ran = 0;

  for (const flow of flows) {
    let mod;
    try {
      mod = await import(pathToFileURL(flow.file).href + `?t=${Date.now()}`);
    } catch (err) {
      findings.add({
        layer: 'functional',
        severity: 'alto',
        title: `Fluxo "${flow.name}" não carregou`,
        detail: `${toPosix(path.relative(projectDir, flow.file))}: ${err.message}`,
        fix: 'O arquivo precisa exportar default uma função async (ctx) => {} ou { run }. Veja references/flows.md.',
      });
      continue;
    }
    const def = mod.default;
    const run = typeof def === 'function' ? def : def?.run;
    const meta = typeof def === 'object' ? def : {};
    if (typeof run !== 'function') {
      findings.add({
        layer: 'functional',
        severity: 'alto',
        title: `Fluxo "${flow.name}" sem função de execução`,
        detail: 'Nenhum export default executável encontrado.',
        fix: 'Exporte default async (ctx) => {} ou { name, run }. Veja references/flows.md.',
      });
      continue;
    }
    if (meta.targets && !meta.targets.includes(target)) {
      log.info(`Fluxo "${flow.name}" pulado (targets: ${meta.targets.join(', ')})`);
      continue;
    }

    ran++;
    log.step(`Fluxo: ${flow.name}`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: target === 'local' });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    let currentStep = 'início';
    const flowErrors = attachObserver(page, observations, () => `fluxo:${flow.name}`);
    const flowCtx = {
      page,
      context,
      baseUrl,
      target,
      productionLike,
      env,
      log: (m) => log.info(`  [${flow.name}] ${m}`),
      goto: (route, opts = {}) => page.goto(joinUrl(baseUrl, route), { waitUntil: 'load', timeout: config.timeouts.navigationMs, ...opts }),
      step: async (name, fn) => {
        currentStep = name;
        return await fn();
      },
      assert: createAssert(page),
    };

    try {
      await withTimeout(Promise.resolve(run(flowCtx)), config.timeouts.flowMs, `fluxo ${flow.name}`);
      const pageErrs = flowErrors.pageErrors.length;
      if (pageErrs) {
        findings.add({
          layer: 'functional',
          severity: 'medio',
          title: `Fluxo "${flow.name}" passou com exceções de JavaScript`,
          detail: flowErrors.pageErrors.map((e) => e.text).slice(0, 5).join('\n'),
          fix: 'O fluxo concluiu, mas o app lançou exceções não tratadas durante ele.',
        });
      }
      log.ok(`Fluxo ${flow.name} ok`);
    } catch (err) {
      const shot = path.join(shotsDir, `${flow.name}-falha.png`);
      await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      log.error(`Fluxo ${flow.name} falhou no passo "${currentStep}"`);
      findings.add({
        layer: 'functional',
        severity: 'alto',
        title: `Fluxo "${meta.name || flow.name}" falhou`,
        detail: `Passo: ${currentStep}\n${err.message}`,
        fix: 'Reproduza o passo no navegador. Se o fluxo mudou de propósito, atualize o arquivo do fluxo no mesmo commit da mudança.',
        evidence: fs.existsSync(shot) ? [toPosix(path.relative(runDir, shot))] : [],
        groupKey: flow.name,
      });
    } finally {
      try {
        observations.cookies.push(...(await context.cookies()).map((c) => ({ route: `fluxo:${flow.name}`, name: c.name, value: c.value, domain: c.domain })));
      } catch {
        // contexto já fechado
      }
      await snapshotStorage(page, `fluxo:${flow.name}`, observations);
      await context.close().catch(() => {});
    }
  }
  return { ran };
}

export async function runFunctional(ctx) {
  const { browser, baseUrl, routes, config, mode, findings, log, target } = ctx;
  const observations = ctx.observations || createObservations();
  ctx.observations = observations;
  const origin = new URL(baseUrl).origin;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: target === 'local' });
  const page = await context.newPage();
  let currentRoute = '/';
  const errors = attachObserver(page, observations, () => currentRoute);
  const links = new Map();
  const loaded = new Set();
  const notes = [];
  let homeFailed = false;

  for (const route of routes) {
    currentRoute = route;
    const url = joinUrl(baseUrl, route);
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'load', timeout: config.timeouts.navigationMs });
      await settlePage(page);
    } catch (err) {
      if (route === '/') homeFailed = true;
      findings.add({
        layer: 'functional',
        severity: 'alto',
        title: 'Rota não carrega',
        detail: `${route}: ${err.message.split('\n')[0]}`,
        fix: 'Abra a rota no navegador e verifique o terminal do servidor.',
        route,
        groupKey: route,
      });
      continue;
    }

    const status = response?.status() ?? 0;
    if (status >= 400) {
      if (route === '/') homeFailed = true;
      findings.add({
        layer: 'functional',
        severity: 'alto',
        title: `Rota responde ${status >= 500 ? 'com erro de servidor' : 'com erro'} (${status})`,
        detail: `${route} → HTTP ${status}`,
        fix: status >= 500 ? 'Veja o log do servidor para o stack trace.' : 'A rota existe no projeto ou foi listada, mas responde erro. Confira middleware, redirects e dados obrigatórios.',
        route,
        groupKey: `${status}`,
      });
    } else {
      loaded.add(new URL(page.url()).pathname.replace(/\/+$/, '') || '/');
    }

    const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.href)).catch(() => []);
    for (const href of hrefs) {
      try {
        const u = new URL(href);
        if (u.origin !== origin || !/^https?:$/.test(u.protocol)) continue;
        u.hash = '';
        const key = u.toString();
        if (!links.has(key)) links.set(key, new Set());
        links.get(key).add(route);
      } catch {
        // href inválido
      }
    }
    await snapshotStorage(page, route, observations);
  }

  // Console e exceções
  for (const e of errors.pageErrors) {
    findings.add({
      layer: 'functional',
      severity: 'alto',
      title: 'Exceção de JavaScript não tratada',
      detail: e.text,
      fix: 'Exceção não tratada pode quebrar interatividade (hydration, handlers). Corrija a origem, não silencie com try/catch vazio.',
      route: e.route,
    });
  }
  for (const e of errors.console) {
    const hydration = /hydrat/i.test(e.text);
    findings.add({
      layer: 'functional',
      severity: hydration ? 'alto' : 'medio',
      title: hydration ? 'Erro de hidratação do React' : 'Erro no console',
      detail: e.text.length > 600 ? e.text.slice(0, 600) + '…' : e.text,
      fix: hydration
        ? 'Servidor e cliente renderizaram HTML diferente (datas, Math.random, window no render, HTML inválido). Corrija a divergência.'
        : 'Investigue a origem do erro. Se for de script de terceiro fora do seu controle, registre uma exceção com motivo.',
      route: e.route,
    });
  }

  // Requests
  for (const e of errors.failed) {
    const sameOrigin = e.url.startsWith(origin);
    findings.add({
      layer: 'functional',
      severity: sameOrigin ? 'alto' : 'baixo',
      title: sameOrigin ? 'Request do próprio site falhou' : 'Request de terceiro falhou',
      detail: `${shortUrl(e.url, origin)} (${e.resourceType}): ${e.failure}`,
      fix: sameOrigin ? 'Asset ou API do próprio projeto não respondeu.' : 'Script/serviço externo indisponível ou bloqueado. Confirme se é esperado.',
      route: e.route,
      groupKey: shortUrl(e.url, origin),
    });
  }
  const navigated = new Set(routes.map((r) => joinUrl(baseUrl, r).replace(/\/+$/, '')));
  for (const e of errors.badResponses) {
    if (e.resourceType === 'document' && navigated.has(e.url.replace(/\/+$/, ''))) continue; // já reportado como rota com erro
    const sameOrigin = e.url.startsWith(origin);
    const critical = ['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(e.resourceType);
    findings.add({
      layer: 'functional',
      severity: sameOrigin ? (critical ? 'alto' : 'medio') : 'baixo',
      title: `${sameOrigin ? 'Recurso do site' : 'Recurso de terceiro'} com HTTP ${e.status}`,
      detail: `${shortUrl(e.url, origin)} (${e.resourceType})`,
      fix: e.resourceType === 'image' || e.resourceType === 'font' ? 'Arquivo ausente ou caminho errado.' : 'Endpoint ou asset retornando erro.',
      route: e.route,
      groupKey: shortUrl(e.url, origin),
    });
  }

  // Links internos
  const checkLinks = mode.checkLinks && config.functional.checkLinks;
  if (checkLinks) {
    const toCheck = [...links.keys()].filter((l) => !loaded.has(new URL(l).pathname.replace(/\/+$/, '') || '/')).slice(0, config.functional.maxLinks);
    if (links.size > toCheck.length + loaded.size) notes.push(`Links internos limitados a ${config.functional.maxLinks} (functional.maxLinks).`);
    log.step(`Checando ${toCheck.length} link(s) interno(s)`);
    await mapLimit(toCheck, 6, async (link) => {
      try {
        const res = await context.request.get(link, { maxRedirects: 5, timeout: 15000, failOnStatusCode: false });
        if (res.status() >= 400) {
          const from = [...links.get(link)];
          findings.add({
            layer: 'functional',
            severity: 'alto',
            title: `Link interno quebrado (${res.status()})`,
            detail: `${new URL(link).pathname} (linkado em ${from.slice(0, 5).join(', ')})`,
            fix: 'Corrija o href ou crie a página.',
            route: from[0],
            groupKey: link,
          });
        }
        await res.dispose().catch(() => {});
      } catch (err) {
        findings.add({
          layer: 'functional',
          severity: 'medio',
          title: 'Link interno não respondeu',
          detail: `${new URL(link).pathname}: ${err.message.split('\n')[0]}`,
          fix: 'Pode ser lentidão ou redirect em loop. Abra manualmente.',
          groupKey: link,
        });
      }
    });
  }

  try {
    observations.cookies.push(...(await context.cookies()).map((c) => ({ route: '*', name: c.name, value: c.value, domain: c.domain })));
  } catch {
    // ignora
  }
  await context.close();

  if (homeFailed && ctx.failFast) {
    notes.push('A home não carregou: camadas seguintes interrompidas (fail-fast).');
    ctx.stopAfterLayer = true;
  }

  const flowResult = await runFlows(ctx, observations);
  if (flowResult.ran) notes.push(`${flowResult.ran} fluxo(s) executado(s) de ${FLOWS_DIR}/.`);
  else notes.push(`Nenhum fluxo em ${FLOWS_DIR}/. Fluxos críticos (formulário, login, checkout) só são testados se existirem ali.`);

  return { status: null, notes, routesChecked: routes.length, linksChecked: checkLinks ? Math.min(links.size, config.functional.maxLinks) : 0 };
}

