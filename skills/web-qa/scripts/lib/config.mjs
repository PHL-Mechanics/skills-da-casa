import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_FILE = 'qa.config.json';
export const ENV_FILE = '.env.qa';
export const RUNS_DIR = '.qa-runs';
export const FLOWS_DIR = 'qa/flows';

export const ALL_LAYERS = ['build', 'functional', 'visual', 'a11y-seo', 'lgpd', 'performance'];
export const BROWSER_LAYERS = ['functional', 'visual', 'a11y-seo', 'lgpd', 'performance'];

export const LAYER_LABEL = {
  build: 'Build',
  functional: 'Funcional',
  visual: 'Visual',
  'a11y-seo': 'Acessibilidade e SEO',
  lgpd: 'LGPD',
  performance: 'Performance',
};

export const DEFAULT_BUDGETS = {
  lcpMs: 2500,
  cls: 0.1,
  tbtMs: 200,
  fcpMs: 1800,
  totalKb: 1600,
  jsKb: 450,
};

export const DEFAULTS = {
  project: '',
  targets: {
    local: { baseUrl: 'http://localhost:3000', server: null },
    remote: { baseUrl: '' },
  },
  build: { commands: null },
  routes: { discover: true, include: [], exclude: [], max: 25 },
  breakpoints: [375, 768, 1440],
  visual: { maxSlicesPerPage: 4, sliceHeightFactor: 1.5, reducedMotion: true, mask: [] },
  functional: { checkLinks: true, maxLinks: 150 },
  performance: { routes: ['/'], runs: 3, formFactor: 'mobile' },
  budgets: { ...DEFAULT_BUDGETS },
  a11y: { tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  seo: { expectIndexable: 'auto' },
  lgpd: { allowlist: [] },
  exceptions: [],
  timeouts: { navigationMs: 45000, flowMs: 90000, buildMs: 900000, serverReadyMs: 90000 },
};

export const MODES = {
  rapido: {
    label: 'rápido',
    layers: ['build', 'functional', 'visual', 'lgpd'],
    buildScope: 'quick',
    breakpoints: 'edges',
    maxSlicesPerPage: 2,
    checkLinks: false,
  },
  completo: {
    label: 'completo',
    layers: [...ALL_LAYERS],
    buildScope: 'full',
    breakpoints: 'all',
    maxSlicesPerPage: null,
    checkLinks: true,
  },
};

const MODE_ALIASES = { rapido: 'rapido', 'rápido': 'rapido', quick: 'rapido', completo: 'completo', full: 'completo' };

export function resolveMode(name = 'rapido') {
  const key = MODE_ALIASES[String(name).toLowerCase()];
  if (!key) {
    throw new ConfigError(`Modo "${name}" não existe. Modos suportados: rapido, completo.`);
  }
  return { key, ...MODES[key] };
}

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, override) {
  if (!isPlainObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) && isPlainObject(base?.[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

export function configPath(projectDir) {
  return path.join(projectDir, CONFIG_FILE);
}

export function loadConfig(projectDir, { allowMissing = false } = {}) {
  const file = configPath(projectDir);
  let raw = {};
  let exists = false;
  if (fs.existsSync(file)) {
    exists = true;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new ConfigError(`${CONFIG_FILE} não é um JSON válido: ${err.message}`);
    }
  } else if (!allowMissing) {
    throw new ConfigError(`${CONFIG_FILE} não encontrado em ${projectDir}. Caminho suportado: node <SKILL_DIR>/scripts/run.mjs init`);
  }
  const config = deepMerge(DEFAULTS, raw);
  if (!config.project) config.project = readPackageName(projectDir) || path.basename(projectDir);
  validateConfig(config, raw);
  return { config, exists, raw };
}

export function readPackageJson(projectDir) {
  const file = path.join(projectDir, 'package.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readPackageName(projectDir) {
  return readPackageJson(projectDir)?.name || null;
}

function validUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateConfig(config, raw = {}) {
  const errors = [];

  for (const [name, target] of Object.entries(config.targets || {})) {
    if (!['local', 'remote'].includes(name)) {
      errors.push(`targets.${name}: alvo desconhecido. Alvos suportados: "local" e "remote". Para outra URL (preview), use --url.`);
      continue;
    }
    if (target.baseUrl && !validUrl(target.baseUrl)) {
      errors.push(`targets.${name}.baseUrl: "${target.baseUrl}" não é uma URL http(s) válida.`);
    }
    if (target.server !== null && target.server !== undefined) {
      if (!isPlainObject(target.server) || typeof target.server.command !== 'string' || !target.server.command.trim()) {
        errors.push(`targets.${name}.server: formato suportado é {"command": "npm run start"} ou null.`);
      }
    }
  }

  if (!Array.isArray(config.breakpoints) || !config.breakpoints.length || config.breakpoints.some((b) => !Number.isInteger(b) || b < 280 || b > 3840)) {
    errors.push('breakpoints: lista de larguras inteiras entre 280 e 3840. Exemplo: [375, 768, 1440].');
  }

  const cmds = config.build?.commands;
  if (cmds !== null && cmds !== undefined) {
    const okArray = Array.isArray(cmds) && cmds.every((c) => typeof c === 'string');
    const okObject = isPlainObject(cmds) && ['quick', 'full'].every((k) => cmds[k] === undefined || (Array.isArray(cmds[k]) && cmds[k].every((c) => typeof c === 'string')));
    if (!okArray && !okObject) {
      errors.push('build.commands: use null (auto-detecção), uma lista de comandos ou {"quick": [...], "full": [...]}.');
    }
  }

  // Budgets: afrouxar além do padrão é uma exceção de arquitetura e exige motivo explícito.
  const loosened = Object.entries(DEFAULT_BUDGETS)
    .filter(([key, def]) => typeof raw?.budgets?.[key] === 'number' && raw.budgets[key] > def)
    .map(([key, def]) => `${key} (${raw.budgets[key]} > padrão ${def})`);
  if (loosened.length && !(typeof raw?.budgets?.reason === 'string' && raw.budgets.reason.trim().length >= 10)) {
    errors.push(
      `budgets: ${loosened.join(', ')} está acima do padrão sem justificativa. ` +
        'Caminho suportado: adicione "reason" em budgets explicando o motivo (mín. 10 caracteres). O afrouxamento aparece no relatório.'
    );
  }

  if (!Array.isArray(config.exceptions)) {
    errors.push('exceptions: deve ser uma lista.');
  } else {
    config.exceptions.forEach((ex, i) => {
      const where = `exceptions[${i}]`;
      if (!isPlainObject(ex)) {
        errors.push(`${where}: formato suportado é {"layer": "functional", "match": "texto ou re:regex", "reason": "por quê"}.`);
        return;
      }
      if (!ex.layer || !['*', ...ALL_LAYERS].includes(ex.layer)) {
        errors.push(`${where}.layer: use uma camada (${ALL_LAYERS.join(', ')}). "*" só é aceito com "routes" definido.`);
      }
      if (ex.layer === '*' && !(Array.isArray(ex.routes) && ex.routes.length)) {
        errors.push(`${where}: exceção com layer "*" precisa ser estreita. Defina "routes".`);
      }
      if (typeof ex.match !== 'string' || ex.match.trim().length < 3) {
        errors.push(`${where}.match: texto (mín. 3 caracteres) ou "re:<regex>" que casa com o título/detalhe do achado.`);
      } else if (ex.match.startsWith('re:')) {
        try {
          new RegExp(ex.match.slice(3));
        } catch (err) {
          errors.push(`${where}.match: regex inválida (${err.message}).`);
        }
        if (/^re:\.\*$|^re:\.\+$/.test(ex.match)) errors.push(`${where}.match: regex que casa com tudo não é uma exceção, é desligar a camada.`);
      }
      if (typeof ex.reason !== 'string' || ex.reason.trim().length < 10) {
        errors.push(`${where}.reason: toda exceção precisa de um motivo com pelo menos 10 caracteres.`);
      }
      if (ex.expires !== undefined && Number.isNaN(Date.parse(ex.expires))) {
        errors.push(`${where}.expires: data inválida. Use AAAA-MM-DD.`);
      }
      if (ex.routes !== undefined && !(Array.isArray(ex.routes) && ex.routes.every((r) => typeof r === 'string'))) {
        errors.push(`${where}.routes: lista de rotas, ex.: ["/contato"].`);
      }
    });
  }

  if (!Array.isArray(config.lgpd?.allowlist)) {
    errors.push('lgpd.allowlist: lista de {"match": "contato@empresa.com.br", "reason": "..."}');
  } else {
    config.lgpd.allowlist.forEach((entry, i) => {
      if (!isPlainObject(entry) || typeof entry.match !== 'string' || typeof entry.reason !== 'string' || entry.reason.trim().length < 10) {
        errors.push(`lgpd.allowlist[${i}]: formato suportado é {"match": "valor público", "reason": "por que é público (mín. 10 caracteres)"}.`);
      }
    });
  }

  if (errors.length) {
    throw new ConfigError(`${CONFIG_FILE} inválido:\n  - ${errors.join('\n  - ')}`);
  }
  return true;
}

export function loadEnvFile(projectDir) {
  const file = path.join(projectDir, ENV_FILE);
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

export function pickBreakpoints(breakpoints, strategy) {
  const sorted = [...new Set(breakpoints)].sort((a, b) => a - b);
  if (strategy === 'edges' && sorted.length > 2) return [sorted[0], sorted[sorted.length - 1]];
  return sorted;
}

export function isProductionLike(baseUrl) {
  try {
    const { hostname } = new URL(baseUrl);
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname)) return false;
    return !/(\.vercel\.app$|preview|staging|homolog|hml|dev\.|test\.)/i.test(hostname);
  } catch {
    return false;
  }
}
