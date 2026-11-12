import crypto from 'node:crypto';
import { redactText } from './lgpd-patterns.mjs';
import { SEVERITIES } from './util.mjs';

function stableId(key) {
  return 'F' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 8);
}

export function createFindings() {
  const byKey = new Map();

  function add(input) {
    const layer = input.layer;
    const severity = SEVERITIES.includes(input.severity) ? input.severity : 'medio';
    const title = redactText(input.title || 'Achado sem título');
    const detail = redactText(input.detail || '');
    const key = `${layer}|${severity}|${title}|${input.groupKey ?? detail}`;
    const existing = byKey.get(key);

    if (existing) {
      existing.count += 1;
      if (input.route && !existing.routes.includes(input.route)) existing.routes.push(input.route);
      if (input.breakpoint && !existing.breakpoints.includes(input.breakpoint)) existing.breakpoints.push(input.breakpoint);
      for (const ev of input.evidence || []) {
        if (existing.evidence.length < 6 && !existing.evidence.includes(ev)) existing.evidence.push(ev);
      }
      return existing;
    }

    const finding = {
      id: stableId(key),
      layer,
      severity,
      title,
      detail,
      fix: redactText(input.fix || ''),
      routes: input.route ? [input.route] : [],
      breakpoints: input.breakpoint ? [input.breakpoint] : [],
      evidence: [...(input.evidence || [])].slice(0, 6),
      source: input.source || 'auto',
      count: 1,
      data: input.data || null,
    };
    byKey.set(key, finding);
    return finding;
  }

  return {
    add,
    all: () => [...byKey.values()],
    forLayer: (layer) => [...byKey.values()].filter((f) => f.layer === layer),
  };
}

function exceptionMatches(exception, finding) {
  if (exception.layer !== '*' && exception.layer !== finding.layer) return false;
  if (Array.isArray(exception.routes) && exception.routes.length) {
    const routeHit = finding.routes.length && finding.routes.every((r) => exception.routes.includes(r));
    if (!routeHit) return false;
  }
  const haystack = `${finding.title}\n${finding.detail}`;
  const m = exception.match;
  if (m.startsWith('re:')) return new RegExp(m.slice(3), 'i').test(haystack);
  return haystack.toLowerCase().includes(m.toLowerCase());
}

/**
 * Exceções: estreitas, explícitas e revisáveis.
 * - Achado que casa com exceção válida vai para "suppressed" (continua visível no relatório).
 * - Exceção vencida não suprime nada e vira achado Médio.
 * - Exceção que não casou com nada é listada como "sem uso" para ser removida.
 */
export function applyExceptions(findings, exceptions = [], now = new Date()) {
  const kept = [];
  const suppressed = [];
  const expiredFindings = [];
  const usage = exceptions.map(() => 0);

  const active = exceptions.map((ex) => ({
    ...ex,
    expired: ex.expires ? Date.parse(ex.expires) < now.getTime() : false,
  }));

  active.forEach((ex, i) => {
    if (ex.expired) {
      expiredFindings.push({
        layer: ex.layer === '*' ? 'functional' : ex.layer,
        severity: 'medio',
        title: 'Exceção vencida na config',
        detail: `exceptions[${i}] ("${ex.match}") venceu em ${ex.expires}. Motivo registrado: ${ex.reason}`,
        fix: 'Resolva o problema de origem e remova a exceção, ou renove a data com um novo motivo revisado.',
        groupKey: `expired-${i}`,
      });
    }
  });

  for (const finding of findings) {
    const idx = active.findIndex((ex) => !ex.expired && exceptionMatches(ex, finding));
    if (idx >= 0) {
      usage[idx] += 1;
      suppressed.push({ ...finding, suppressedBy: { index: idx, match: active[idx].match, reason: active[idx].reason } });
    } else {
      kept.push(finding);
    }
  }

  const exceptionReport = active.map((ex, i) => ({
    index: i,
    layer: ex.layer,
    match: ex.match,
    routes: ex.routes || null,
    reason: ex.reason,
    expires: ex.expires || null,
    expired: ex.expired,
    matched: usage[i],
  }));

  return { kept, suppressed, expiredFindings, exceptionReport };
}

export function countBySeverity(findings) {
  const counts = { alto: 0, medio: 0, baixo: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] || 0) + 1;
  return counts;
}

export function sortFindings(findings) {
  const order = { alto: 0, medio: 1, baixo: 2 };
  return [...findings].sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count || a.title.localeCompare(b.title));
}
