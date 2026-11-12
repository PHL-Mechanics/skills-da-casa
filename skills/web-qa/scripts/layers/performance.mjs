import fs from 'node:fs';
import path from 'node:path';
import * as chromeLauncher from 'chrome-launcher';
import { chromeExecutablePath, extraChromeArgs } from '../lib/browser.mjs';
import { DEFAULT_BUDGETS } from '../lib/config.mjs';
import { ensureDir, formatMs, joinUrl, median, slugifyRoute, toPosix } from '../lib/util.mjs';

async function detectDevMode(browser, baseUrl, timeoutMs) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(joinUrl(baseUrl, '/'), { waitUntil: 'load', timeout: timeoutMs });
    return await page.evaluate(() => {
      const scripts = [...document.scripts].map((s) => s.src || '');
      if (scripts.some((s) => /\/_next\/static\/chunks\/(webpack\.js|.*turbopack)|\/_next\/static\/development\//.test(s))) return 'Next.js (next dev)';
      if (scripts.some((s) => /\/@vite\/client/.test(s))) return 'Vite (dev server)';
      const data = document.getElementById('__NEXT_DATA__')?.textContent || '';
      if (/"buildId"\s*:\s*"development"/.test(data)) return 'Next.js (next dev)';
      return null;
    });
  } catch {
    return null;
  } finally {
    await context.close();
  }
}

function metric(lhr, id) {
  const v = lhr.audits?.[id]?.numericValue;
  return typeof v === 'number' ? v : null;
}

function jsBytes(lhr) {
  const items = lhr.audits?.['network-requests']?.details?.items || [];
  const total = items.filter((i) => i.resourceType === 'Script').reduce((sum, i) => sum + (i.transferSize || 0), 0);
  return items.length ? total : null;
}

function topIssues(lhr, limit = 5) {
  const refs = lhr.categories?.performance?.auditRefs || [];
  return refs
    .filter((ref) => ['insights', 'diagnostics', 'load-opportunities'].includes(ref.group))
    .map((ref) => lhr.audits[ref.id])
    .filter((a) => a && typeof a.score === 'number' && a.score < 0.9 && a.scoreDisplayMode !== 'informative' && a.scoreDisplayMode !== 'notApplicable')
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((a) => `${a.title}${a.displayValue ? ` (${a.displayValue})` : ''}`);
}

function severityFor(value, budget, { hard = 1.5 } = {}) {
  if (value === null || budget === undefined) return null;
  if (value <= budget) return null;
  return value > budget * hard ? 'alto' : 'medio';
}

export async function runPerformance(ctx) {
  const { browser, baseUrl, routes, config, findings, runDir, log, target, args } = ctx;
  const notes = [];

  const devMode = await detectDevMode(browser, baseUrl, config.timeouts.navigationMs);
  if (devMode && !args.forcePerf) {
    return {
      status: 'pulada',
      notes: [`Servidor em modo desenvolvimento detectado (${devMode}). Números de dev não representam produção. Rode com build de produção (next build && next start), use --target remote, ou force com --force-perf.`],
    };
  }
  if (devMode) notes.push(`Atenção: medido em ${devMode} por --force-perf. Números servem só para comparação relativa.`);

  const { default: lighthouse, desktopConfig } = await import('lighthouse');
  const perfRoutes = (config.performance.routes || ['/']).filter((r) => routes.includes(r) || r === '/');
  const runs = Math.max(1, Number(config.performance.runs) || 3);
  const budgets = { ...DEFAULT_BUDGETS, ...config.budgets };
  const lhDir = ensureDir(path.join(runDir, 'lighthouse'));
  const results = [];

  const chromePath = chromeExecutablePath();
  const chrome = await chromeLauncher.launch({
    chromePath: chromePath || undefined,
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', ...extraChromeArgs()],
  });

  try {
    for (const route of perfRoutes) {
      const url = joinUrl(baseUrl, route);
      const samples = [];
      let lastLhr = null;
      for (let i = 0; i < runs; i++) {
        log.step(`Lighthouse ${route} (${i + 1}/${runs}, ${config.performance.formFactor})`);
        try {
          const flags = { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance'] };
          const lhConfig = config.performance.formFactor === 'desktop' ? desktopConfig : undefined;
          const runner = await lighthouse(url, flags, lhConfig);
          const lhr = runner?.lhr;
          if (!lhr) throw new Error('Lighthouse não retornou resultado.');
          if (lhr.runtimeError) throw new Error(lhr.runtimeError.message);
          lastLhr = lhr;
          samples.push({
            score: lhr.categories.performance.score !== null ? Math.round(lhr.categories.performance.score * 100) : null,
            lcpMs: metric(lhr, 'largest-contentful-paint'),
            cls: metric(lhr, 'cumulative-layout-shift'),
            tbtMs: metric(lhr, 'total-blocking-time'),
            fcpMs: metric(lhr, 'first-contentful-paint'),
            totalKb: metric(lhr, 'total-byte-weight') !== null ? metric(lhr, 'total-byte-weight') / 1024 : null,
            jsKb: jsBytes(lhr) !== null ? jsBytes(lhr) / 1024 : null,
          });
        } catch (err) {
          notes.push(`Lighthouse falhou em ${route} (execução ${i + 1}): ${err.message.split('\n')[0]}`);
        }
      }
      if (!samples.length) continue;

      const m = {};
      for (const key of ['score', 'lcpMs', 'cls', 'tbtMs', 'fcpMs', 'totalKb', 'jsKb']) m[key] = median(samples.map((s) => s[key]));
      const lhFile = path.join(lhDir, `${slugifyRoute(route)}.json`);
      if (lastLhr) fs.writeFileSync(lhFile, JSON.stringify(lastLhr), 'utf8');
      const issues = lastLhr ? topIssues(lastLhr) : [];
      results.push({ route, runs: samples.length, median: m, issues, file: toPosix(path.relative(runDir, lhFile)) });

      const evidence = [toPosix(path.relative(runDir, lhFile))];
      const issueText = issues.length ? `\nPrincipais causas apontadas pelo Lighthouse:\n${issues.map((i) => `• ${i}`).join('\n')}` : '';
      const checks = [
        { key: 'lcpMs', label: 'LCP', fmt: formatMs, fix: 'Priorize a imagem/texto principal (next/image com priority, fetchpriority="high"), reduza JS bloqueante e fontes sem font-display.' },
        { key: 'cls', label: 'CLS', fmt: (v) => v.toFixed(3), fix: 'Reserve espaço para imagens, embeds e fontes (width/height, aspect-ratio, size-adjust). Não injete conteúdo acima do conteúdo existente.', hard: 2.5 },
        { key: 'tbtMs', label: 'TBT', fmt: formatMs, fix: 'Menos JS no carregamento: dynamic import, Server Components, adiar scripts de terceiros (next/script strategy="lazyOnload").' },
        { key: 'fcpMs', label: 'FCP', fmt: formatMs, fix: 'CSS crítico enxuto, fontes com preload, TTFB do servidor/CDN.' },
        { key: 'totalKb', label: 'Peso total', fmt: (v) => `${Math.round(v)} KB`, fix: 'Imagens em AVIF/WebP no tamanho exibido, vídeo de fundo comprimido e com preload="none" no mobile.' },
        { key: 'jsKb', label: 'JavaScript', fmt: (v) => `${Math.round(v)} KB`, fix: 'Analise com @next/bundle-analyzer. GSAP/Three/Lottie só nas rotas que usam.' },
      ];
      for (const c of checks) {
        const sev = severityFor(m[c.key], budgets[c.key], { hard: c.hard || 1.5 });
        if (!sev) continue;
        findings.add({
          layer: 'performance',
          severity: sev,
          title: `${c.label} acima do budget`,
          detail: `${route}: ${c.fmt(m[c.key])} (budget ${c.fmt(budgets[c.key])}, mediana de ${samples.length} execução(ões), ${config.performance.formFactor})${c.key === 'lcpMs' ? issueText : ''}`,
          fix: c.fix,
          route,
          evidence,
          groupKey: `${c.key}|${route}`,
        });
      }
      log.ok(`${route}: nota ${m.score ?? '?'} · LCP ${m.lcpMs !== null ? formatMs(m.lcpMs) : '?'} · CLS ${m.cls !== null ? m.cls.toFixed(3) : '?'} · TBT ${m.tbtMs !== null ? formatMs(m.tbtMs) : '?'}`);
    }
  } finally {
    try {
      await chrome.kill();
    } catch {
      // já encerrado
    }
  }

  if (target === 'local') notes.push('Medido na sua máquina, sem a latência real de rede/CDN. Para número de produção, rode também com --target remote.');
  notes.push('A nota do Lighthouse varia entre execuções; os budgets avaliam as métricas (mediana), não a nota.');
  ctx.performanceResults = results;
  return { status: results.length ? null : 'erro', notes, results };
}
