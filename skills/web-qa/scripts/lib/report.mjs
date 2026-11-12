import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigError, LAYER_LABEL } from './config.mjs';
import { countBySeverity, sortFindings } from './findings.mjs';
import { formatMs, SEVERITY_LABEL } from './util.mjs';

export const REPORT_FILE = 'report.json';
export const INTEGRITY_FILE = '.integrity';
export const VISUAL_REVIEW_FILE = 'visual-review.json';

export function computeLayerStatus(layerResult, findings, layer) {
  const raw = layerResult?.rawStatus;
  if (raw === 'pulada' || raw === 'erro' || raw === 'nao-executada') return raw;
  const own = findings.filter((f) => f.layer === layer);
  if (raw === 'falhou' || own.some((f) => f.severity === 'alto')) return 'falhou';
  if (own.some((f) => f.severity === 'medio')) return 'atencao';
  return 'ok';
}

export function buildVerdict(report) {
  const counts = countBySeverity(report.findings);
  const erroredLayers = Object.entries(report.layers).filter(([, l]) => l.status === 'erro').map(([k]) => LAYER_LABEL[k]);
  let text;
  if (counts.alto > 0) text = `${counts.alto} ${counts.alto === 1 ? 'problema' : 'problemas'} de impacto alto`;
  else if (counts.medio > 0) text = `Nenhum problema alto, ${counts.medio} de impacto médio`;
  else text = 'Nenhum problema alto ou médio';
  const caveats = [];
  if (erroredLayers.length) caveats.push(`camada(s) com erro de execução: ${erroredLayers.join(', ')}`);
  if (report.meta.stoppedEarly) caveats.push('execução interrompida por fail-fast');
  if (report.layers.visual && report.layers.visual.status !== 'pulada' && report.layers.visual.status !== 'nao-executada' && !report.visual?.reviewDone) caveats.push('revisão visual dos screenshots pendente');
  return { counts, text, caveats, exitCode: counts.alto > 0 ? 1 : 0 };
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function writeReport(runDir, report) {
  report.findings = sortFindings(report.findings);
  for (const [layer, data] of Object.entries(report.layers)) {
    data.status = computeLayerStatus(data, report.findings, layer);
    data.counts = countBySeverity(report.findings.filter((f) => f.layer === layer));
  }
  report.verdict = buildVerdict(report);
  const json = JSON.stringify(report, null, 2) + '\n';
  fs.writeFileSync(path.join(runDir, REPORT_FILE), json, 'utf8');
  fs.writeFileSync(path.join(runDir, INTEGRITY_FILE), sha256(json) + '\n', 'utf8');
  fs.writeFileSync(path.join(runDir, 'report.html'), renderHtml(report), 'utf8');
  fs.writeFileSync(path.join(runDir, 'summary.md'), renderSummary(report, runDir), 'utf8');
  return report;
}

export function readReportVerified(runDir) {
  const file = path.join(runDir, REPORT_FILE);
  if (!fs.existsSync(file)) throw new ConfigError(`Nenhum ${REPORT_FILE} em ${runDir}.`);
  const json = fs.readFileSync(file, 'utf8');
  const integrityFile = path.join(runDir, INTEGRITY_FILE);
  const expected = fs.existsSync(integrityFile) ? fs.readFileSync(integrityFile, 'utf8').trim() : null;
  if (!expected || expected !== sha256(json)) {
    throw new ConfigError(
      `${REPORT_FILE} foi alterado fora do runner. O relatório tem um único escritor. ` +
        `Caminho suportado: registre achados visuais em ${VISUAL_REVIEW_FILE} e rode "finalize"; para mudar resultados automáticos, rode a verificação de novo.`
    );
  }
  return JSON.parse(json);
}

/* ---------- Markdown (para o agente ler e resumir no chat) ---------- */

function renderSummary(report, runDir) {
  const { verdict, meta } = report;
  const lines = [];
  lines.push(`# web-qa: ${meta.project}`);
  lines.push('');
  lines.push(`**Resultado:** ${verdict.text}${verdict.caveats.length ? ` (${verdict.caveats.join('; ')})` : ''}`);
  lines.push('');
  lines.push(`- Alvo: ${meta.target} (${meta.baseUrl})`);
  lines.push(`- Modo: ${meta.modeLabel}`);
  lines.push(`- Rotas (${meta.routes.length}, via ${meta.routesSource}): ${meta.routes.join(', ')}`);
  lines.push(`- Duração: ${formatMs(meta.durationMs)}`);
  lines.push('');
  lines.push('| Camada | Status | Alto | Médio | Baixo | Tempo |');
  lines.push('|---|---|---|---|---|---|');
  for (const [key, l] of Object.entries(report.layers)) {
    lines.push(`| ${LAYER_LABEL[key]} | ${statusLabel(l.status)} | ${l.counts.alto} | ${l.counts.medio} | ${l.counts.baixo} | ${l.durationMs ? formatMs(l.durationMs) : '-'} |`);
  }
  lines.push('');
  for (const sev of ['alto', 'medio']) {
    const list = report.findings.filter((f) => f.severity === sev);
    if (!list.length) continue;
    lines.push(`## Impacto ${SEVERITY_LABEL[sev].toLowerCase()} (${list.length})`);
    lines.push('');
    for (const f of list) {
      const where = [f.routes.length ? f.routes.slice(0, 4).join(', ') : null, f.breakpoints.length ? f.breakpoints.map((b) => `${b}px`).join('/') : null].filter(Boolean).join(' @ ');
      lines.push(`- **[${f.id}] ${f.title}** (${LAYER_LABEL[f.layer]}${where ? `, ${where}` : ''})`);
      const firstDetail = f.detail.split('\n').slice(0, 3).join(' | ');
      if (firstDetail) lines.push(`  - ${firstDetail}`);
      if (f.fix) lines.push(`  - Correção: ${f.fix}`);
    }
    lines.push('');
  }
  const baixos = report.findings.filter((f) => f.severity === 'baixo');
  if (baixos.length) {
    lines.push(`## Impacto baixo (${baixos.length})`);
    lines.push('');
    lines.push(baixos.map((f) => `- [${f.id}] ${f.title}`).join('\n'));
    lines.push('');
  }
  if (report.suppressed.length || report.exceptions.length) {
    lines.push('## Exceções ativas');
    lines.push('');
    for (const ex of report.exceptions) {
      lines.push(`- exceptions[${ex.index}] ${ex.layer} "${ex.match}": ${ex.reason}${ex.expires ? ` (vence ${ex.expires})` : ''}, suprimiu ${ex.matched}${ex.matched === 0 ? ' (sem uso: remova)' : ''}`);
    }
    if (report.budgets.loosened.length) lines.push(`- Budgets afrouxados: ${report.budgets.loosened.join(', ')}. Motivo: ${report.budgets.reason}`);
    lines.push('');
  }
  const notes = [...report.notes, ...Object.entries(report.layers).flatMap(([k, l]) => (l.notes || []).map((n) => `${LAYER_LABEL[k]}: ${n}`))];
  if (notes.length) {
    lines.push('## Notas da execução');
    lines.push('');
    lines.push(notes.map((n) => `- ${n}`).join('\n'));
    lines.push('');
  }
  if (report.layers.visual && !report.visual.reviewDone && report.visual.manifest?.length) {
    lines.push('## Revisão visual pendente');
    lines.push('');
    lines.push(`Screenshots em \`visual/\` (${report.visual.manifest.reduce((s, m) => s + m.files.length, 0)} arquivos, índice em visual/manifest.json).`);
    lines.push(`Registre achados em \`${VISUAL_REVIEW_FILE}\` e rode: node <SKILL_DIR>/scripts/run.mjs finalize "${runDir}"`);
    lines.push('');
  }
  lines.push(`Relatório completo: ${path.join(runDir, 'report.html')}`);
  return lines.join('\n') + '\n';
}

function statusLabel(status) {
  return (
    {
      ok: 'ok',
      atencao: 'atenção',
      falhou: 'falhou',
      pulada: 'pulada',
      erro: 'erro de execução',
      'nao-executada': 'não executada',
    }[status] || status
  );
}

/* ---------- HTML ---------- */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function renderFinding(f) {
  const routesPart = f.routes.length ? `em ${f.routes.slice(0, 6).map(esc).join(', ')}${f.routes.length > 6 ? ` e mais ${f.routes.length - 6}` : ''}` : '';
  const bpPart = f.breakpoints.length ? f.breakpoints.map((b) => `${b}px`).join(', ') : '';
  const where = routesPart && bpPart ? `${routesPart} (${bpPart})` : routesPart || bpPart;
  const images = f.evidence.filter((e) => /\.png$/i.test(e));
  const files = f.evidence.filter((e) => !/\.png$/i.test(e));
  return `
  <details class="finding sev-${f.severity}" id="${f.id}">
    <summary>
      <span class="sev-tag">${SEVERITY_LABEL[f.severity]}</span>
      <span class="f-title">${esc(f.title)}</span>
      <span class="f-meta">${esc(LAYER_LABEL[f.layer])}${where ? `, ${where}` : ''}${f.source === 'revisao-visual' ? ', encontrado na revisão visual' : ''}</span>
    </summary>
    <div class="f-body">
      ${f.detail ? `<pre class="f-detail">${esc(f.detail)}</pre>` : ''}
      ${f.fix ? `<p class="f-fix"><strong>Como corrigir.</strong> ${esc(f.fix)}</p>` : ''}
      ${images.length ? `<div class="f-shots">${images.map((i) => `<a href="${esc(i)}" target="_blank" rel="noopener"><img src="${esc(i)}" alt="Evidência de ${esc(f.title)}" loading="lazy"></a>`).join('')}</div>` : ''}
      ${files.length ? `<p class="f-files">Arquivos: ${files.map((i) => `<a href="${esc(i)}">${esc(i)}</a>`).join(', ')}</p>` : ''}
      <p class="f-id">ID ${f.id}${f.count > 1 ? `, ocorreu ${f.count} vezes` : ''}</p>
    </div>
  </details>`;
}

function renderHtml(report) {
  const { meta, verdict } = report;
  const layerRows = Object.entries(report.layers)
    .map(
      ([key, l]) => `
      <tr>
        <th scope="row">${esc(LAYER_LABEL[key])}</th>
        <td><span class="status st-${l.status}">${esc(statusLabel(l.status))}</span></td>
        <td class="num">${l.counts.alto || ''}</td>
        <td class="num">${l.counts.medio || ''}</td>
        <td class="num">${l.counts.baixo || ''}</td>
        <td class="num">${l.durationMs ? esc(formatMs(l.durationMs)) : ''}</td>
        <td class="notes">${(l.notes || []).map((n) => `<p>${esc(n)}</p>`).join('')}</td>
      </tr>`
    )
    .join('');

  const sections = ['alto', 'medio', 'baixo']
    .map((sev) => {
      const list = report.findings.filter((f) => f.severity === sev);
      if (!list.length) return '';
      return `<section class="group"><h2>Impacto ${SEVERITY_LABEL[sev].toLowerCase()} <span class="count">${list.length}</span></h2>${list.map(renderFinding).join('')}</section>`;
    })
    .join('');

  const perf = (report.performance || [])
    .map(
      (r) => `
      <tr>
        <th scope="row">${esc(r.route)}</th>
        <td class="num">${r.median.score ?? '-'}</td>
        <td class="num">${r.median.lcpMs !== null ? esc(formatMs(r.median.lcpMs)) : '-'}</td>
        <td class="num">${r.median.cls !== null ? r.median.cls.toFixed(3) : '-'}</td>
        <td class="num">${r.median.tbtMs !== null ? esc(formatMs(r.median.tbtMs)) : '-'}</td>
        <td class="num">${r.median.totalKb !== null ? Math.round(r.median.totalKb) + ' KB' : '-'}</td>
        <td class="num">${r.median.jsKb !== null ? Math.round(r.median.jsKb) + ' KB' : '-'}</td>
      </tr>`
    )
    .join('');

  const byRoute = new Map();
  for (const m of report.visual?.manifest || []) {
    if (!byRoute.has(m.route)) byRoute.set(m.route, []);
    byRoute.get(m.route).push(m);
  }
  const gallery = [...byRoute.entries()]
    .map(
      ([route, shots]) => `
    <section class="route-shots">
      <h3>${esc(route)}</h3>
      <div class="shots">
        ${shots
          .map(
            (s) => `
          <figure style="--bp:${s.breakpoint}">
            ${s.files[0] ? `<a href="${esc(s.files[0])}" target="_blank" rel="noopener"><img src="${esc(s.files[0])}" alt="${esc(route)} em ${s.breakpoint}px" loading="lazy"></a>` : '<div class="noshot">sem captura</div>'}
            <figcaption>${s.breakpoint}px${s.files.length > 1 ? `, ${s.files.slice(1).map((f, i) => `<a href="${esc(f)}" target="_blank" rel="noopener">parte ${i + 2}</a>`).join(', ')}` : ''}${s.truncated ? ', página não coberta inteira' : ''}</figcaption>
          </figure>`
          )
          .join('')}
      </div>
    </section>`
    )
    .join('');

  const exceptions = report.exceptions.length || report.budgets.loosened.length
    ? `<section class="block">
        <h2>Exceções ativas</h2>
        <p class="lede">Cada exceção esconde achados de propósito. Revise se ainda faz sentido.</p>
        <table class="plain">
          <thead><tr><th scope="col">Camada</th><th scope="col">Casa com</th><th scope="col">Motivo</th><th scope="col">Validade</th><th scope="col" class="num">Suprimiu</th></tr></thead>
          <tbody>
          ${report.exceptions
            .map(
              (ex) => `<tr class="${ex.expired ? 'expired' : ''}${ex.matched === 0 ? ' unused' : ''}"><td>${esc(ex.layer)}</td><td><code>${esc(ex.match)}</code>${ex.routes ? `<br><small>${esc(ex.routes.join(', '))}</small>` : ''}</td><td>${esc(ex.reason)}</td><td>${ex.expires ? esc(ex.expires) + (ex.expired ? ' (vencida)' : '') : 'sem data'}</td><td class="num">${ex.matched}${ex.matched === 0 ? ' <small>sem uso</small>' : ''}</td></tr>`
            )
            .join('')}
          ${report.budgets.loosened.length ? `<tr><td>performance</td><td>${esc(report.budgets.loosened.join(', '))}</td><td>${esc(report.budgets.reason)}</td><td>sem data</td><td class="num">-</td></tr>` : ''}
          </tbody>
        </table>
        ${report.suppressed.length ? `<details class="suppressed"><summary>${report.suppressed.length} achado(s) suprimido(s)</summary><ul>${report.suppressed.map((s) => `<li><strong>${esc(s.title)}</strong> (${SEVERITY_LABEL[s.severity]}, ${esc(LAYER_LABEL[s.layer])}) por exceptions[${s.suppressedBy.index}]</li>`).join('')}</ul></details>` : ''}
      </section>`
    : '';

  const dismissed = report.visual?.dismissed?.length
    ? `<details class="suppressed"><summary>${report.visual.dismissed.length} achado(s) automático(s) descartado(s) na revisão visual</summary><ul>${report.visual.dismissed.map((d) => `<li><strong>${esc(d.title)}</strong> [${esc(d.id)}]: ${esc(d.reason)}</li>`).join('')}</ul></details>`
    : '';

  const caveat = verdict.caveats.length ? `<p class="caveat">${esc(verdict.caveats.join('. ').replace(/^./, (c) => c.toUpperCase()))}.</p>` : '';

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.project)}: ${esc(verdict.text)}</title>
<style>
  :root {
    --bg: #F2F3F0;
    --surface: #FFFFFF;
    --ink: #202329;
    --muted: #5E636B;
    --rule: #D9DBD6;
    --alto: #B42318;
    --medio: #A15C07;
    --baixo: #4B5563;
    --ok: #0F6B3E;
    --focus: #2B59C3;
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  a { color: inherit; text-underline-offset: 3px; }
  a:focus-visible, summary:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 2px; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 48px 28px 96px; }
  header.top { display: grid; gap: 6px; margin-bottom: 40px; }
  .project { font-size: 15px; font-weight: 600; margin: 0; }
  .meta { color: var(--muted); margin: 0; font-size: 14px; }
  .meta span + span::before { content: "  /  "; color: var(--rule); }
  .verdict {
    margin: 28px 0 0; font-size: clamp(34px, 5.4vw, 60px); line-height: 1.04; font-weight: 650;
    letter-spacing: -0.028em; max-width: 18ch;
  }
  .verdict.v-alto { color: var(--alto); }
  .caveat { margin: 14px 0 0; color: var(--muted); max-width: 70ch; }
  .block, .group { margin-top: 56px; }
  h2 { font-size: 21px; letter-spacing: -0.01em; margin: 0 0 16px; font-weight: 640; }
  h2 .count { color: var(--muted); font-weight: 500; }
  h3 { font-size: 16px; margin: 0 0 12px; font-weight: 600; }
  .lede { color: var(--muted); margin: -8px 0 16px; }
  table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--rule); }
  th, td { text-align: left; padding: 11px 14px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  thead th { font-size: 13px; color: var(--muted); font-weight: 560; }
  tbody tr:last-child th, tbody tr:last-child td { border-bottom: 0; }
  th[scope="row"] { font-weight: 600; white-space: nowrap; }
  .num { text-align: right; white-space: nowrap; }
  td.notes p { margin: 0 0 4px; color: var(--muted); font-size: 13.5px; max-width: 60ch; }
  .status { font-weight: 600; white-space: nowrap; }
  .status::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; vertical-align: 1px; background: currentColor; }
  .st-ok { color: var(--ok); } .st-atencao { color: var(--medio); } .st-falhou { color: var(--alto); }
  .st-pulada, .st-nao-executada { color: var(--muted); } .st-erro { color: var(--alto); }
  .finding { background: var(--surface); border: 1px solid var(--rule); border-left: 4px solid var(--baixo); margin: 0 0 10px; }
  .finding.sev-alto { border-left-color: var(--alto); }
  .finding.sev-medio { border-left-color: var(--medio); }
  .finding summary { cursor: pointer; list-style: none; padding: 14px 18px; display: grid; grid-template-columns: 64px 1fr; column-gap: 12px; row-gap: 2px; }
  .finding summary::-webkit-details-marker { display: none; }
  .sev-tag { grid-row: span 2; font-size: 13px; font-weight: 650; padding-top: 1px; }
  .sev-alto .sev-tag { color: var(--alto); } .sev-medio .sev-tag { color: var(--medio); } .sev-baixo .sev-tag { color: var(--baixo); }
  .f-title { font-weight: 600; }
  .f-meta { color: var(--muted); font-size: 13.5px; }
  .f-body { padding: 0 18px 18px 94px; }
  .f-detail { white-space: pre-wrap; word-break: break-word; font: 13px/1.5 ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace; background: var(--bg); padding: 12px 14px; margin: 0 0 12px; max-height: 360px; overflow: auto; }
  .f-fix { margin: 0 0 12px; max-width: 75ch; }
  .f-shots { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
  .f-shots img { display: block; max-width: 260px; max-height: 200px; object-fit: cover; object-position: top; border: 1px solid var(--rule); }
  .f-files, .f-id { color: var(--muted); font-size: 13px; margin: 0; }
  .pending { margin-top: 32px; border: 1px solid var(--medio); background: var(--surface); padding: 14px 18px; max-width: 75ch; }
  .route-shots { margin-bottom: 36px; }
  .shots { display: flex; gap: 16px; align-items: flex-start; overflow-x: auto; padding-bottom: 6px; }
  .shots figure { margin: 0; flex: 0 0 auto; width: clamp(140px, calc(var(--bp) * 0.24px), 360px); }
  .shots img { display: block; width: 100%; max-height: 520px; object-fit: cover; object-position: top; border: 1px solid var(--rule); background: var(--surface); }
  .shots figcaption { font-size: 13px; color: var(--muted); margin-top: 6px; }
  .noshot { height: 120px; display: grid; place-items: center; border: 1px dashed var(--rule); color: var(--muted); font-size: 13px; }
  table.plain code { font-size: 13px; }
  tr.expired td { color: var(--alto); }
  tr.unused td { color: var(--muted); }
  .suppressed { margin-top: 14px; }
  .suppressed summary { cursor: pointer; color: var(--muted); }
  .suppressed ul { margin: 10px 0 0; padding-left: 20px; }
  .empty { background: var(--surface); border: 1px solid var(--rule); padding: 18px; color: var(--muted); }
  footer { margin-top: 64px; color: var(--muted); font-size: 13px; }
  @media (max-width: 720px) {
    .wrap { padding: 28px 16px 64px; }
    .f-body { padding-left: 18px; }
    .finding summary { grid-template-columns: 1fr; }
    .sev-tag { grid-row: auto; }
    table { display: block; overflow-x: auto; }
  }
  @media (prefers-reduced-motion: no-preference) {
    .verdict { animation: rise .5s cubic-bezier(.2,.7,.2,1) both; }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  }
</style>
</head>
<body>
<main class="wrap">
  <header class="top">
    <p class="project">${esc(meta.project)}</p>
    <p class="meta"><span>${esc(meta.target === 'local' ? 'Local' : 'Remoto')}: <a href="${esc(meta.baseUrl)}">${esc(meta.baseUrl)}</a></span><span>Modo ${esc(meta.modeLabel)}</span><span>${esc(new Date(meta.startedAt).toLocaleString('pt-BR'))}</span><span>${esc(formatMs(meta.durationMs))}</span></p>
    <h1 class="verdict ${verdict.counts.alto ? 'v-alto' : ''}">${esc(verdict.text)}</h1>
    ${caveat}
  </header>

  ${report.layers.visual && !report.visual.reviewDone && report.visual.manifest?.length ? `<p class="pending"><strong>Revisão visual pendente.</strong> Os checks automáticos de layout rodaram, mas os screenshots ainda não foram revisados. Achados de hierarquia, alinhamento e sobreposição entram depois do <code>finalize</code>.</p>` : ''}

  <section class="block">
    <h2>Camadas</h2>
    <table>
      <thead><tr><th scope="col">Camada</th><th scope="col">Status</th><th scope="col" class="num">Alto</th><th scope="col" class="num">Médio</th><th scope="col" class="num">Baixo</th><th scope="col" class="num">Tempo</th><th scope="col">Notas</th></tr></thead>
      <tbody>${layerRows}</tbody>
    </table>
    ${report.notes.length ? `<div class="caveat">${report.notes.map((n) => `<p>${esc(n)}</p>`).join('')}</div>` : ''}
  </section>

  ${sections || '<section class="group"><h2>Achados</h2><p class="empty">Nenhum achado nas camadas executadas.</p></section>'}
  ${dismissed ? `<section class="block">${dismissed}</section>` : ''}

  ${perf ? `<section class="block"><h2>Performance</h2><p class="lede">Mediana das execuções do Lighthouse, perfil ${esc(report.meta.formFactor || 'mobile')}.</p><table><thead><tr><th scope="col">Rota</th><th scope="col" class="num">Nota</th><th scope="col" class="num">LCP</th><th scope="col" class="num">CLS</th><th scope="col" class="num">TBT</th><th scope="col" class="num">Peso</th><th scope="col" class="num">JS</th></tr></thead><tbody>${perf}</tbody></table></section>` : ''}

  ${exceptions}

  ${gallery ? `<section class="block"><h2>Screenshots</h2><p class="lede">Primeira dobra de cada rota por largura. Clique para abrir no tamanho real.</p>${gallery}</section>` : ''}

  <footer>
    <p>Rotas verificadas (${meta.routes.length}, via ${esc(meta.routesSource)}): ${meta.routes.map(esc).join(', ')}</p>
    <p>Gerado por web-qa. Este relatório tem um único escritor: o runner. Achados visuais entram via visual-review.json e finalize.</p>
  </footer>
</main>
</body>
</html>`;
}
