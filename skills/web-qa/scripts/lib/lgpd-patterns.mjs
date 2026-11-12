// Detecção de dado pessoal em URLs, textos de console e storage.
// Tudo que sai daqui já vem MASCARADO: o relatório nunca pode virar o vazamento.

const CPF_RE = /(?<![\d.])(\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?![\d])/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const FORMATTED_PHONE_RE = /\(?\b\d{2}\)?\s?9?\d{4}-\d{4}\b/g;
const FILE_EXT_TLD = /\.(png|jpe?g|webp|avif|gif|svg|ico|js|mjs|css|map|woff2?|ttf|otf|json|html?|mp4|webm)$/i;

export const KEY_PATTERNS = {
  telefone: /(^|[_\-.])(tel|telefone|phone|fone|celular|cel|whats|whatsapp|mobile)([_\-.]|$)/i,
  saude: /(diagnostico|diagnóstico|patologia|doenca|doença|prontuario|prontuário|cartao_?sus|cartaosus|cns|exame|medicamento|cid10|cid_10|alergia|convenio_?medico)/i,
  segredo: /(^|[_\-.])(token|access_token|id_token|refresh_token|auth|jwt|apikey|api_key|secret|senha|password|session|sessionid)([_\-.]|$)/i,
  documento: /(^|[_\-.])(cpf|rg|documento|doc_?pessoa)([_\-.]|$)/i,
};

export function onlyDigits(value) {
  return String(value || '').replace(/\D+/g, '');
}

export function isValidCPF(value) {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export function maskCPF(value) {
  const d = onlyDigits(value);
  return `***.***.***-${d.slice(9, 11)}`;
}

export function maskEmail(email) {
  const [local, domain = ''] = String(email).split('@');
  const parts = domain.split('.');
  const tld = parts.length > 1 ? parts.slice(1).join('.') : '';
  return `${local.slice(0, 1)}***@${(parts[0] || '').slice(0, 1)}***${tld ? '.' + tld : ''}`;
}

export function maskPhone(value) {
  const d = onlyDigits(value);
  return `(**) *****-**${d.slice(-2)}`;
}

export function maskSecret(value) {
  const s = String(value || '');
  return `${s.slice(0, 4)}… (${s.length} caracteres)`;
}

function isAllowed(value, allowlist = []) {
  const v = String(value || '').toLowerCase();
  return allowlist.some((entry) => {
    const s = String(entry.match ?? entry);
    if (s.startsWith('re:')) return new RegExp(s.slice(3), 'i').test(value);
    return v.includes(s.toLowerCase());
  });
}

export function findCPFs(text) {
  const out = [];
  for (const m of String(text || '').matchAll(CPF_RE)) {
    if (isValidCPF(m[1])) out.push({ raw: m[1], masked: maskCPF(m[1]) });
  }
  return out;
}

export function findEmails(text) {
  const out = [];
  for (const m of String(text || '').matchAll(EMAIL_RE)) {
    const email = m[0];
    const domain = email.split('@')[1] || '';
    if (FILE_EXT_TLD.test(email)) continue;
    if (/^\d+x\./i.test(domain)) continue; // logo@2x.png
    out.push({ raw: email, masked: maskEmail(email) });
  }
  return out;
}

export function redactText(text) {
  if (text === null || text === undefined) return text;
  let out = String(text);
  for (const hit of findCPFs(out)) out = out.split(hit.raw).join(hit.masked);
  for (const hit of findEmails(out)) out = out.split(hit.raw).join(hit.masked);
  out = out.replace(FORMATTED_PHONE_RE, (m) => maskPhone(m));
  return out;
}

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value).replace(/\+/g, ' '));
  } catch {
    return String(value);
  }
}

/**
 * Varre uma URL de request. Retorna hits e uma versão mascarada da URL
 * (valores de parâmetros sem hit viram "…" para não vazar nada no relatório).
 */
export function scanUrl(url, { allowlist = [] } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { hits: [], maskedUrl: '[url inválida]' };
  }
  const hits = [];
  const decodedPath = safeDecode(parsed.pathname);

  for (const cpf of findCPFs(decodedPath)) {
    if (!isAllowed(cpf.raw, allowlist)) hits.push({ kind: 'cpf', where: 'caminho', key: null, masked: cpf.masked });
  }
  for (const email of findEmails(decodedPath)) {
    if (!isAllowed(email.raw, allowlist)) hits.push({ kind: 'email', where: 'caminho', key: null, masked: email.masked });
  }

  const hitKeys = new Map();
  for (const [key, rawValue] of parsed.searchParams.entries()) {
    const value = safeDecode(rawValue);
    if (!value || isAllowed(value, allowlist)) continue;
    const found = [];
    for (const cpf of findCPFs(value)) found.push({ kind: 'cpf', masked: cpf.masked });
    for (const email of findEmails(value)) found.push({ kind: 'email', masked: email.masked });
    const digits = onlyDigits(value);
    if (KEY_PATTERNS.documento.test(key) && digits.length >= 8 && !found.some((f) => f.kind === 'cpf')) {
      found.push({ kind: 'documento', masked: `***${digits.slice(-2)}` });
    }
    if (KEY_PATTERNS.telefone.test(key) && digits.length >= 10 && digits.length <= 13) {
      found.push({ kind: 'telefone', masked: maskPhone(digits) });
    } else if (FORMATTED_PHONE_RE.test(value)) {
      found.push({ kind: 'telefone', masked: maskPhone(value) });
    }
    FORMATTED_PHONE_RE.lastIndex = 0;
    if (KEY_PATTERNS.saude.test(key) && value.trim().length > 0) {
      found.push({ kind: 'saude', masked: '***' });
    }
    if (KEY_PATTERNS.segredo.test(key) && value.length >= 16) {
      found.push({ kind: 'segredo', masked: maskSecret(value) });
    }
    if (found.length) {
      hitKeys.set(key, found[0].masked);
      for (const f of found) hits.push({ ...f, where: 'query', key });
    }
  }

  const params = [...new Set([...parsed.searchParams.keys()])].map((k) => `${k}=${hitKeys.has(k) ? hitKeys.get(k) : '…'}`);
  const maskedUrl = `${parsed.origin}${redactText(decodedPath)}${params.length ? '?' + params.join('&') : ''}`;
  return { hits, maskedUrl };
}

export function scanText(text, { allowlist = [] } = {}) {
  const hits = [];
  for (const cpf of findCPFs(text)) if (!isAllowed(cpf.raw, allowlist)) hits.push({ kind: 'cpf', masked: cpf.masked });
  for (const email of findEmails(text)) if (!isAllowed(email.raw, allowlist)) hits.push({ kind: 'email', masked: email.masked });
  return hits;
}

export const KIND_LABEL = {
  cpf: 'CPF',
  email: 'e-mail',
  telefone: 'telefone',
  saude: 'dado de saúde',
  segredo: 'token/segredo',
  documento: 'documento pessoal',
};
