import fs from 'node:fs';
import { createRequire } from 'node:module';
import AxeBuilderModule from '@axe-core/playwright';
import { isProductionLike } from '../lib/config.mjs';
import { joinUrl, settlePage } from '../lib/util.mjs';

const require = createRequire(import.meta.url);
const AxeBuilder = AxeBuilderModule.default || AxeBuilderModule;

// AxeBuilder não expõe configure(); o locale entra injetando o próprio axe já configurado.
let axeSource;
try {
  const ptBR = require('axe-core/locales/pt_BR.json');
  const core = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  axeSource = `${core}\n;axe.configure({ locale: ${JSON.stringify(ptBR)} });`;
} catch {
  axeSource = undefined;
}

const IMPACT_TO_SEVERITY = { critical: 'alto', serious: 'alto', moderate: 'medio', minor: 'baixo' };

function collectSeo() {
  const meta = (sel) => document.querySelector(sel)?.getAttribute('content')?.trim() || '';
  return {
    title: document.title?.trim() || '',
    description: meta('meta[name="description"]'),
    lang: document.documentElement.getAttribute('lang') || '',
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '',
    ogTitle: meta('meta[property="og:title"]'),
    ogImage: meta('meta[property="og:image"]'),
    viewport: meta('meta[name="viewport"]'),
    robots: meta('meta[name="robots"]'),
    h1s: [...document.querySelectorAll('h1')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
  };
}

export async function runA11ySeo(ctx) {
  const { browser, baseUrl, routes, config, findings, log, target } = ctx;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: target === 'local' });
  const page = await context.newPage();
  const notes = [];
  const expectIndexable = config.seo.expectIndexable === 'auto' ? target === 'remote' && isProductionLike(baseUrl) : Boolean(config.seo.expectIndexable);
  const titles = new Map();
  let axeOk = 0;
  let axeFailed = 0;

  for (const route of routes) {
    let res;
    try {
      res = await page.goto(joinUrl(baseUrl, route), { waitUntil: 'load', timeout: config.timeouts.navigationMs });
      await settlePage(page);
    } catch {
      continue;
    }
    if (res && res.status() >= 400) continue;

    // Acessibilidade
    try {
      const result = await new AxeBuilder({ page, axeSource }).withTags(config.a11y.tags).analyze();
      axeOk++;
      for (const v of result.violations) {
        const targets = v.nodes.slice(0, 4).map((n) => (Array.isArray(n.target) ? n.target.join(' ') : String(n.target)));
        findings.add({
          layer: 'a11y-seo',
          severity: IMPACT_TO_SEVERITY[v.impact] || 'medio',
          title: `Acessibilidade: ${v.help}`,
          detail: `${v.nodes.length} elemento(s) (regra ${v.id}). Exemplos:\n${targets.map((t) => `• ${t}`).join('\n')}`,
          fix: `${v.description} Referência: ${v.helpUrl}`,
          route,
          groupKey: v.id,
          data: { rule: v.id },
        });
      }
    } catch (err) {
      axeFailed++;
      notes.push(`axe falhou em ${route}: ${err.message.split('\n')[0]}`);
    }

    // SEO técnico
    const seo = await page.evaluate(collectSeo).catch(() => null);
    if (!seo) continue;
    const headerRobots = res?.headers()['x-robots-tag'] || '';

    if (!seo.title) {
      findings.add({ layer: 'a11y-seo', severity: 'alto', title: 'Página sem <title>', detail: route, fix: 'Defina metadata.title (App Router) ou <title>.', route, groupKey: 'no-title' });
    } else {
      if (seo.title.length > 65) findings.add({ layer: 'a11y-seo', severity: 'baixo', title: 'Title longo (corta no Google)', detail: `${route}: ${seo.title.length} caracteres`, fix: 'Mantenha entre 30 e 65 caracteres.', route, groupKey: 'long-title' });
      if (!titles.has(seo.title)) titles.set(seo.title, []);
      titles.get(seo.title).push(route);
    }
    if (!seo.description) {
      findings.add({ layer: 'a11y-seo', severity: 'medio', title: 'Página sem meta description', detail: route, fix: 'Defina metadata.description com 70 a 160 caracteres.', route, groupKey: 'no-desc' });
    } else if (seo.description.length < 50 || seo.description.length > 170) {
      findings.add({ layer: 'a11y-seo', severity: 'baixo', title: 'Meta description fora do tamanho ideal', detail: `${route}: ${seo.description.length} caracteres`, fix: 'Entre 70 e 160 caracteres.', route, groupKey: 'desc-size' });
    }
    if (seo.h1s.length === 0) {
      findings.add({ layer: 'a11y-seo', severity: 'medio', title: 'Página sem H1', detail: route, fix: 'Cada página precisa de um H1 que diga do que ela trata.', route, groupKey: 'no-h1' });
    } else if (seo.h1s.length > 1) {
      findings.add({ layer: 'a11y-seo', severity: 'baixo', title: 'Mais de um H1', detail: `${route}: ${seo.h1s.slice(0, 3).map((h) => `"${h.slice(0, 50)}"`).join(', ')}`, fix: 'Use um H1 e desça a hierarquia com H2/H3.', route, groupKey: 'multi-h1' });
    }
    if (!seo.lang) findings.add({ layer: 'a11y-seo', severity: 'medio', title: 'HTML sem atributo lang', detail: route, fix: 'Use <html lang="pt-BR">.', route, groupKey: 'no-lang' });
    if (!seo.viewport) findings.add({ layer: 'a11y-seo', severity: 'alto', title: 'Sem meta viewport', detail: route, fix: 'Sem viewport o mobile renderiza como desktop encolhido.', route, groupKey: 'no-viewport' });
    if (!seo.ogTitle || !seo.ogImage) {
      findings.add({ layer: 'a11y-seo', severity: 'baixo', title: 'Open Graph incompleto', detail: `${route}: ${[!seo.ogTitle && 'og:title', !seo.ogImage && 'og:image'].filter(Boolean).join(' e ')} ausente`, fix: 'Sem OG o link compartilhado no WhatsApp/LinkedIn sai sem imagem e título certos.', route, groupKey: 'og' });
    }
    const noindex = /noindex/i.test(seo.robots) || /noindex/i.test(headerRobots);
    if (expectIndexable && noindex) {
      findings.add({ layer: 'a11y-seo', severity: 'alto', title: 'Página de produção bloqueada para indexação', detail: `${route}: ${seo.robots ? `meta robots="${seo.robots}"` : ''} ${headerRobots ? `X-Robots-Tag="${headerRobots}"` : ''}`.trim(), fix: 'Remova noindex em produção. Se for intencional (área logada, obrigado), registre uma exceção com motivo.', route, groupKey: 'noindex' });
    }
    if (expectIndexable && !seo.canonical) {
      findings.add({ layer: 'a11y-seo', severity: 'baixo', title: 'Sem link canonical', detail: route, fix: 'Defina metadata.alternates.canonical para evitar conteúdo duplicado.', route, groupKey: 'no-canonical' });
    }
  }

  for (const [title, rs] of titles) {
    if (rs.length > 1) {
      findings.add({ layer: 'a11y-seo', severity: 'medio', title: 'Title duplicado entre páginas', detail: `"${title.slice(0, 70)}" em ${rs.join(', ')}`, fix: 'Cada página precisa de um title próprio.', groupKey: title });
    }
  }

  if (target === 'remote') {
    for (const file of ['/robots.txt', '/sitemap.xml']) {
      try {
        const r = await context.request.get(joinUrl(baseUrl, file), { timeout: 15000, failOnStatusCode: false });
        if (r.status() >= 400) {
          findings.add({ layer: 'a11y-seo', severity: expectIndexable ? 'medio' : 'baixo', title: `${file} ausente`, detail: `HTTP ${r.status()}`, fix: file === '/robots.txt' ? 'Crie app/robots.ts.' : 'Crie app/sitemap.ts.', groupKey: file });
        }
        await r.dispose().catch(() => {});
      } catch {
        // ignora
      }
    }
  }

  if (!expectIndexable) notes.push('Indexação não exigida neste alvo (local ou preview). Checagens de noindex/canonical desativadas.');
  await context.close();
  // Acessibilidade que não rodou não pode aparecer como "ok".
  const status = axeFailed > 0 && axeOk === 0 ? 'erro' : null;
  if (axeFailed > 0 && axeOk > 0) notes.push(`axe rodou em ${axeOk} rota(s) e falhou em ${axeFailed}.`);
  return { status, notes };
}
