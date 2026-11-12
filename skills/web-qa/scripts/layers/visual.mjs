import path from 'node:path';
import { autoScroll, ensureDir, joinUrl, settlePage, slugifyRoute, toPosix, writeJson } from '../lib/util.mjs';

function viewportFor(width) {
  if (width <= 480) return { width, height: 812, isMobile: true };
  if (width <= 1024) return { width, height: 1024, isMobile: false };
  return { width, height: 900, isMobile: false };
}

// Roda dentro da página. Não pode referenciar nada de fora.
function domChecks(isMobile) {
  const MAX = 6;
  const vw = document.documentElement.clientWidth;
  const out = { docOverflow: 0, overflow: [], brokenImages: [], clipped: [], smallTargets: [], smallTargetsTotal: 0, tinyText: [], invisibleText: [], leftovers: [] };

  const selectorOf = (el) => {
    const parts = [];
    let node = el;
    for (let depth = 0; node && node.nodeType === 1 && depth < 3; depth++) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part += `#${node.id}`;
        parts.unshift(part);
        break;
      }
      const classes = [...node.classList].filter((c) => !/^(css-|sc-|jsx-|_)/.test(c) && c.length < 30).slice(0, 2);
      if (classes.length) part += '.' + classes.join('.');
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  const directText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim();

  const isInFixed = (el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const pos = getComputedStyle(p).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
    }
    return false;
  };

  const all = [...document.body.querySelectorAll('*')];

  // 1. Overflow horizontal
  out.docOverflow = Math.max(0, document.documentElement.scrollWidth - vw);
  if (out.docOverflow > 1) {
    const offenders = [];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right <= vw + 1 && r.left >= -1) continue;
      if (isInFixed(el)) continue;
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/(hidden|clip|auto|scroll)/.test(getComputedStyle(p).overflowX)) {
          clipped = true;
          break;
        }
      }
      if (!clipped) offenders.push(el);
    }
    const outermost = offenders.filter((el) => !offenders.some((o) => o !== el && o.contains(el)));
    out.overflow = outermost.slice(0, MAX).map((el) => {
      const r = el.getBoundingClientRect();
      return { selector: selectorOf(el), right: Math.round(r.right), width: Math.round(r.width) };
    });
  }

  // 2. Imagens quebradas
  for (const img of document.images) {
    const src = img.currentSrc || img.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) continue;
    if (img.complete && img.naturalWidth === 0) {
      out.brokenImages.push({ selector: selectorOf(img), src: src.slice(0, 160), alt: img.alt || '' });
      if (out.brokenImages.length >= MAX) break;
    }
  }

  for (const el of all) {
    const text = directText(el);
    if (text.length < 2) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.closest('[aria-hidden="true"], noscript, template, script, style')) continue;

    // 3. Texto cortado por overflow sem reticências intencionais
    if (out.clipped.length < MAX) {
      const clipsX = /(hidden|clip)/.test(cs.overflowX);
      const clipsY = /(hidden|clip)/.test(cs.overflowY);
      const intentional = cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none');
      if (!intentional && ((clipsX && el.scrollWidth > el.clientWidth + 2) || (clipsY && el.scrollHeight > el.clientHeight + 2)) && r.width > 20) {
        out.clipped.push({ selector: selectorOf(el), text: text.slice(0, 80) });
      }
    }

    // 4. Texto invisível depois de rolar (reveal que não disparou)
    if (out.invisibleText.length < MAX && r.width > 1 && r.height > 1) {
      let opacity = 1;
      for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
        opacity *= parseFloat(getComputedStyle(p).opacity || '1');
        if (opacity < 0.05) break;
      }
      if (opacity < 0.05 && text.length > 3) {
        out.invisibleText.push({ selector: selectorOf(el), text: text.slice(0, 80) });
      }
    }

    // 5. Texto pequeno demais no mobile
    if (isMobile && out.tinyText.length < MAX && parseFloat(cs.fontSize) < 12 && text.length > 3) {
      out.tinyText.push({ selector: selectorOf(el), fontSize: cs.fontSize, text: text.slice(0, 60) });
    }

    // 6. Sobras de desenvolvimento
    if (out.leftovers.length < MAX && !el.closest('code, pre, textarea, kbd, samp') && /(\b[Ll]orem [Ii]psum\b|\bundefined\b|\bNaN\b|\[object Object\]|\bTODO:|\bFIXME\b)/.test(text)) {
      out.leftovers.push({ selector: selectorOf(el), text: text.slice(0, 80) });
    }
  }

  // 7. Alvos de toque menores que 24px (WCAG 2.2 AA) no mobile
  if (isMobile) {
    const targets = document.querySelectorAll('a[href], button, [role="button"], input:not([type="hidden"]), select, textarea, summary');
    for (const el of targets) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
      if (el.tagName === 'A') {
        const parent = el.closest('p, li, td, span, label');
        if (parent && (parent.textContent || '').trim().length > (el.textContent || '').trim().length + 10) continue; // link inline em texto
      }
      if (r.width < 24 || r.height < 24) {
        out.smallTargetsTotal++;
        if (out.smallTargets.length < MAX) {
          out.smallTargets.push({ selector: selectorOf(el), size: `${Math.round(r.width)}×${Math.round(r.height)}`, label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40) });
        }
      }
    }
  }

  return { ...out, pageHeight: document.documentElement.scrollHeight };
}

function list(items, fmt) {
  return items.map((i) => `• ${fmt(i)}`).join('\n');
}

export async function runVisual(ctx) {
  const { browser, baseUrl, routes, config, mode, findings, runDir, log, target, breakpoints } = ctx;
  const shotsDir = ensureDir(path.join(runDir, 'visual'));
  const manifest = [];
  const maxSlices = mode.maxSlicesPerPage ?? config.visual.maxSlicesPerPage;
  const notes = [];

  for (const bp of breakpoints) {
    const vp = viewportFor(bp);
    log.step(`Visual em ${bp}px`);
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      isMobile: vp.isMobile,
      hasTouch: vp.isMobile,
      reducedMotion: config.visual.reducedMotion ? 'reduce' : 'no-preference',
      ignoreHTTPSErrors: target === 'local',
    });
    const page = await context.newPage();

    for (const route of routes) {
      try {
        const res = await page.goto(joinUrl(baseUrl, route), { waitUntil: 'load', timeout: config.timeouts.navigationMs });
        if (res && res.status() >= 400) continue; // a camada funcional já reporta
        await settlePage(page);
        await autoScroll(page);
        await settlePage(page, { idleMs: 3000 });
      } catch {
        continue; // a camada funcional já reporta rota que não carrega
      }

      const checks = await page.evaluate(domChecks, vp.isMobile).catch((err) => ({ error: err.message }));
      const slug = slugifyRoute(route);

      const mask = (config.visual.mask || []).map((sel) => page.locator(sel));
      const sliceH = Math.round(vp.height * config.visual.sliceHeightFactor);
      const pageHeight = Math.max(checks.pageHeight || vp.height, vp.height);
      const totalSlices = Math.ceil(pageHeight / sliceH);
      const n = Math.max(1, Math.min(maxSlices, totalSlices));
      const files = [];
      for (let i = 0; i < n; i++) {
        const y = i * sliceH;
        const height = Math.min(sliceH, pageHeight - y);
        if (height <= 0) break;
        const file = path.join(shotsDir, `${slug}__${bp}__${i + 1}.png`);
        try {
          await page.screenshot({ path: file, fullPage: true, clip: { x: 0, y, width: vp.width, height }, animations: 'disabled', caret: 'hide', mask });
          files.push(toPosix(path.relative(runDir, file)));
        } catch (err) {
          notes.push(`Falha ao capturar ${route} em ${bp}px (fatia ${i + 1}): ${err.message.split('\n')[0]}`);
        }
      }
      manifest.push({ route, breakpoint: bp, files, pageHeight, coveredHeight: Math.min(pageHeight, n * sliceH), truncated: totalSlices > n });

      if (checks.error) {
        notes.push(`Checks de DOM falharam em ${route} @${bp}: ${checks.error}`);
        continue;
      }
      const evidence = files.slice(0, 1);

      if (checks.docOverflow > 1) {
        findings.add({
          layer: 'visual',
          severity: 'alto',
          title: 'Rolagem horizontal na página',
          detail: `A página é ${checks.docOverflow}px mais larga que a tela em ${bp}px.\n${list(checks.overflow, (o) => `${o.selector} (termina em ${o.right}px, largura ${o.width}px)`) || 'Elemento causador não isolado (pode ser margem negativa ou transform).'}`,
          fix: 'Procure largura fixa, 100vw com scrollbar, margem negativa ou grid sem minmax(0,1fr). Evite overflow-x:hidden no body como remendo.',
          route,
          breakpoint: bp,
          evidence,
          groupKey: checks.overflow.map((o) => o.selector).join('|') || 'overflow',
        });
      }
      if (checks.brokenImages.length) {
        findings.add({
          layer: 'visual',
          severity: 'alto',
          title: 'Imagem quebrada',
          detail: list(checks.brokenImages, (i) => `${i.src}${i.alt ? ` (alt: ${i.alt})` : ''}`),
          fix: 'Caminho errado, arquivo ausente no deploy ou domínio não liberado em images.remotePatterns do Next.',
          route,
          breakpoint: bp,
          evidence,
          groupKey: checks.brokenImages.map((i) => i.src).join('|'),
        });
      }
      if (checks.invisibleText.length) {
        findings.add({
          layer: 'visual',
          severity: 'medio',
          title: 'Texto invisível depois de rolar a página',
          detail: `${list(checks.invisibleText, (t) => `${t.selector}: "${t.text}"`)}\nPode ser animação de entrada (GSAP/ScrollTrigger/Framer) que não disparou.`,
          fix: 'Confirme no screenshot. Carrossel e slide inativo são falso positivo esperado. Se for reveal travado, garanta estado final visível com prefers-reduced-motion e ScrollTrigger.refresh() após carregar imagens.',
          route,
          breakpoint: bp,
          evidence,
          groupKey: checks.invisibleText.map((t) => t.selector).join('|'),
        });
      }
      if (checks.clipped.length) {
        findings.add({
          layer: 'visual',
          severity: 'medio',
          title: 'Texto cortado por overflow',
          detail: list(checks.clipped, (c) => `${c.selector}: "${c.text}"`),
          fix: 'Altura/largura fixa em container com texto. Use min-height, quebra de linha ou text-overflow intencional.',
          route,
          breakpoint: bp,
          evidence,
          groupKey: checks.clipped.map((c) => c.selector).join('|'),
        });
      }
      if (checks.leftovers.length) {
        findings.add({
          layer: 'visual',
          severity: 'alto',
          title: 'Conteúdo de desenvolvimento visível',
          detail: list(checks.leftovers, (l) => `${l.selector}: "${l.text}"`),
          fix: 'Lorem ipsum, undefined, NaN ou [object Object] na tela. Corrija o dado ou o placeholder.',
          route,
          breakpoint: bp,
          evidence,
          groupKey: checks.leftovers.map((l) => l.text).join('|'),
        });
      }
      if (checks.smallTargetsTotal > 0) {
        findings.add({
          layer: 'visual',
          severity: checks.smallTargetsTotal >= 5 ? 'medio' : 'baixo',
          title: 'Alvos de toque menores que 24px no mobile',
          detail: `${checks.smallTargetsTotal} elemento(s). Exemplos:\n${list(checks.smallTargets, (t) => `${t.selector} ${t.size}${t.label ? ` "${t.label}"` : ''}`)}`,
          fix: 'Aumente a área clicável com padding (mín. 24×24, ideal 44×44) sem mudar o visual do ícone.',
          route,
          breakpoint: bp,
          groupKey: 'small-targets',
        });
      }
      if (checks.tinyText.length) {
        findings.add({
          layer: 'visual',
          severity: 'baixo',
          title: 'Texto menor que 12px no mobile',
          detail: list(checks.tinyText, (t) => `${t.selector} (${t.fontSize}): "${t.text}"`),
          fix: 'Legibilidade ruim no celular. Suba para no mínimo 12px (corpo ideal 16px).',
          route,
          breakpoint: bp,
          groupKey: 'tiny-text',
        });
      }
    }
    await context.close();
  }

  writeJson(path.join(shotsDir, 'manifest.json'), manifest);
  const truncated = manifest.filter((m) => m.truncated).length;
  if (truncated) notes.push(`${truncated} captura(s) não cobrem a página inteira (limite de ${maxSlices} fatias). Rode o modo completo ou aumente visual.maxSlicesPerPage.`);
  ctx.visualManifest = manifest;
  return { status: null, notes, screenshots: manifest.reduce((s, m) => s + m.files.length, 0), reviewRequired: true };
}
