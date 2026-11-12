#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserInstalled, chromeExecutablePath, launchBrowser } from './lib/browser.mjs';
import {
  ALL_LAYERS,
  BROWSER_LAYERS,
  CONFIG_FILE,
  ConfigError,
  DEFAULT_BUDGETS,
  ENV_FILE,
  FLOWS_DIR,
  LAYER_LABEL,
  RUNS_DIR,
  isProductionLike,
  loadConfig,
  loadEnvFile,
  pickBreakpoints,
  readPackageJson,
  resolveMode,
} from './lib/config.mjs';
import { applyExceptions, createFindings } from './lib/findings.mjs';
import { readReportVerified, VISUAL_REVIEW_FILE, writeReport } from './lib/report.mjs';
import { discoverRoutes } from './lib/routes.mjs';
import { isReachable, startServer } from './lib/server.mjs';
import { createLogger, ensureDir, isLocalUrl, readJson, timestamp, SEVERITIES } from './lib/util.mjs';
import { redactText } from './lib/lgpd-patterns.mjs';

const SKILL_SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.dirname(SKILL_SCRIPTS_DIR);

const HELP = `
web-qa: verificação de sites e apps em camadas

Uso:
  node run.mjs [run] [opções]        Roda a verificação
  node run.mjs init [--project dir]  Cria ${CONFIG_FILE}, ${FLOWS_DIR}/ e entradas no .gitignore
  node run.mjs finalize <runDir>     Junta ${VISUAL_REVIEW_FILE} ao relatório
  node run.mjs doctor                Confere dependências e navegador

Opções de run:
  --mode rapido|completo     Padrão: rapido
  --target local|remote      Padrão: local (ou deduzido de --url)
  --url <url>                Sobrescreve a baseUrl (ex.: preview da Vercel)
  --only a,b                 Camadas: ${ALL_LAYERS.join(', ')}
  --routes /,/contato        Verifica só essas rotas
  --project <dir>            Pasta do projeto (padrão: diretório atual)
  --no-fail-fast             Continua mesmo se o build ou a home falhar
  --force-perf               Mede performance mesmo em servidor de dev
  --keep-server              Não derruba o servidor que o runner subiu

Saída: <projeto>/${RUNS_DIR}/<data>-<alvo>-<modo>/ com report.html, report.json, summary.md e visual/.
Código de saída: 0 sem impacto alto, 1 com impacto alto, 2 erro de uso/config/execução.
`;

function parseArgs(argv) {
  const args = { _: [], failFast: true, forcePerf: false, keepServer: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new ConfigError(`A opção ${a} precisa de um valor.`);
      return v;
    };
    if (a === '--mode') args.mode = next();
    else if (a === '--target') args.target = next();
    else if (a === '--url') args.url = next();
    else if (a === '--only') args.only = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--routes') args.routes = next().split(',').map((s) => s.trim()).filter(Boolean).map((r) => (r.startsWith('/') ? r : `/${r}`));
    else if (a === '--project') args.project = next();
    else if (a === '--no-fail-fast') args.failFast = false;
    else if (a === '--force-perf') args.forcePerf = true;
    else if (a === '--keep-server') args.keepServer = true;
    else if (a === '--force') args.force = true;
    else if (a === '-h' || a === '--help') args.help = true;
    else if (a.startsWith('--')) throw new ConfigError(`Opção desconhecida: ${a}. Veja --help.`);
    else args._.push(a);
  }
  return args;
}

/* ---------------- init ---------------- */

function ensureGitignore(projectDir, entries) {
  const file = path.join(projectDir, '.gitignore');
  const isRepo = fs.existsSync(path.join(projectDir, '.git'));
  if (!fs.existsSync(file) && !isRepo) return [];
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = current.split(/\r?\n/).map((l) => l.trim());
  const missing = entries.filter((e) => !lines.includes(e) && !lines.includes(e.replace(/\/$/, '')));
  if (missing.length) {
    const prefix = current && !current.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(file, `${prefix}\n# web-qa (relatórios e credenciais de teste)\n${missing.join('\n')}\n`);
  }
  return missing;
}

function detectLocalTarget(projectDir) {
  const pkg = readPackageJson(projectDir) || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const scripts = pkg.scripts || {};
  const lock = (f) => fs.existsSync(path.join(projectDir, f));
  const run = lock('pnpm-lock.yaml') ? 'pnpm run' : lock('yarn.lock') ? 'yarn' : lock('bun.lockb') || lock('bun.lock') ? 'bun run' : 'npm run';
  if (deps.next) return { baseUrl: 'http://localhost:3000', server: scripts.start ? { command: `${run} start` } : null, framework: 'Next.js' };
  if (deps.astro) return { baseUrl: 'http://localhost:4321', server: scripts.preview ? { command: `${run} preview` } : null, framework: 'Astro' };
  if (deps.vite) return { baseUrl: 'http://localhost:4173', server: scripts.preview ? { command: `${run} preview` } : null, framework: 'Vite' };
  return { baseUrl: 'http://localhost:3000', server: null, framework: null };
}

function cmdInit(args) {
  const projectDir = path.resolve(args.project || process.cwd());
  const configFile = path.join(projectDir, CONFIG_FILE);
  const created = [];

  if (fs.existsSync(configFile) && !args.force) {
    console.log(`• ${CONFIG_FILE} já existe. Nada foi sobrescrito (use --force para recriar).`);
  } else {
    const pkg = readPackageJson(projectDir) || {};
    const local = detectLocalTarget(projectDir);
    const config = {
      $schema: 'web-qa/1',
      project: pkg.name || path.basename(projectDir),
      targets: {
        local: { baseUrl: local.baseUrl, server: local.server },
        remote: { baseUrl: typeof pkg.homepage === 'string' && /^https?:/.test(pkg.homepage) ? pkg.homepage : '' },
      },
      routes: { discover: true, include: [], exclude: [], max: 25 },
      breakpoints: [375, 768, 1440],
      budgets: { ...DEFAULT_BUDGETS },
      lgpd: { allowlist: [] },
      exceptions: [],
    };
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
    created.push(CONFIG_FILE);
    if (local.framework) console.log(`• Framework detectado: ${local.framework}`);
  }

  const flowsDir = path.join(projectDir, FLOWS_DIR);
  if (!fs.existsSync(flowsDir)) {
    ensureDir(flowsDir);
    const example = path.join(SKILL_DIR, 'assets', 'flows', '_exemplo-contato.mjs');
    if (fs.existsSync(example)) {
      fs.copyFileSync(example, path.join(flowsDir, '_exemplo-contato.mjs'));
      created.push(`${FLOWS_DIR}/_exemplo-contato.mjs (desativado pelo "_" no nome)`);
    }
  }

  const envExample = path.join(projectDir, `${ENV_FILE}.example`);
  if (!fs.existsSync(envExample)) {
    fs.writeFileSync(envExample, '# Credenciais de TESTE usadas pelos fluxos de qa/flows. Copie para .env.qa (que fica fora do git).\n# Nunca use conta real de paciente, aluno ou membro.\nQA_USER_EMAIL=\nQA_USER_PASSWORD=\n');
    created.push(`${ENV_FILE}.example`);
  }

  const ignored = ensureGitignore(projectDir, [`${RUNS_DIR}/`, ENV_FILE]);
  if (ignored.length) created.push(`.gitignore: ${ignored.join(', ')}`);

  if (created.length) console.log(`✓ Criado:\n  - ${created.join('\n  - ')}`);
  console.log(`\nPróximo passo: node ${path.join(SKILL_SCRIPTS_DIR, 'run.mjs')} --mode rapido`);
  return 0;
}

/* ---------------- doctor ---------------- */

async function cmdDoctor() {
  let ok = true;
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 18 || (major === 18 && minor < 17)) {
    console.log(`✗ Node ${process.versions.node}: precisa de 18.17 ou superior.`);
    ok = false;
  } else console.log(`✓ Node ${process.versions.node}`);

  const nm = path.join(SKILL_SCRIPTS_DIR, 'node_modules');
  if (!fs.existsSync(nm)) {
    console.log(`✗ Dependências não instaladas. Rode: cd "${SKILL_SCRIPTS_DIR}" && npm install && npx playwright install chromium`);
    return 2;
  }
  console.log('✓ Dependências instaladas');

  if (!browserInstalled()) {
    console.log(`✗ Chromium não encontrado (${chromeExecutablePath() || 'sem caminho'}). Rode: cd "${SKILL_SCRIPTS_DIR}" && npx playwright install chromium`);
    console.log('  Alternativa: defina QA_CHROME_PATH apontando para um Chrome/Chromium instalado.');
    ok = false;
  } else {
    try {
      const browser = await launchBrowser();
      const version = browser.version();
      await browser.close();
      console.log(`✓ Chromium ${version} abre normalmente`);
    } catch (err) {
      console.log(`✗ Chromium instalado mas não abre: ${err.message.split('\n')[0]}`);
      if (process.platform === 'linux') console.log('  Em Linux/WSL: npx playwright install-deps chromium');
      ok = false;
    }
  }
  console.log(`• Plataforma: ${os.platform()} ${os.release()}`);
  return ok ? 0 : 2;
}

/* ---------------- finalize ---------------- */

function validateReviewEntry(entry, i) {
  const where = `${VISUAL_REVIEW_FILE} findings[${i}]`;
  const errors = [];
  if (!entry || typeof entry !== 'object') return [`${where}: precisa ser um objeto.`];
  if (!SEVERITIES.includes(entry.severity)) errors.push(`${where}.severity: use "alto", "medio" ou "baixo".`);
  if (typeof entry.title !== 'string' || entry.title.trim().length < 5) errors.push(`${where}.title: descreva o problema (mín. 5 caracteres).`);
  if (typeof entry.route !== 'string' || !entry.route.startsWith('/')) errors.push(`${where}.route: rota verificada, ex.: "/contato".`);
  if (entry.breakpoint !== undefined && !Number.isInteger(entry.breakpoint)) errors.push(`${where}.breakpoint: largura inteira, ex.: 375.`);
  if (entry.evidence !== undefined && !(Array.isArray(entry.evidence) && entry.evidence.every((e) => typeof e === 'string'))) errors.push(`${where}.evidence: lista de caminhos relativos, ex.: ["visual/home__375__1.png"].`);
  return errors;
}

async function cmdFinalize(args) {
  const runDir = path.resolve(args._[1] || '');
  if (!args._[1] || !fs.existsSync(runDir)) throw new ConfigError('Informe a pasta da execução: node run.mjs finalize <runDir>');
  const report = readReportVerified(runDir);
  const reviewFile = path.join(runDir, VISUAL_REVIEW_FILE);
  if (!fs.existsSync(reviewFile)) {
    throw new ConfigError(`${VISUAL_REVIEW_FILE} não existe em ${runDir}. Formato: {"reviewed": [{"route": "/", "breakpoints": [375, 1440]}], "findings": [], "dismissed": [], "notes": ""}`);
  }
  let review;
  try {
    review = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));
  } catch (err) {
    throw new ConfigError(`${VISUAL_REVIEW_FILE} não é JSON válido: ${err.message}`);
  }

  const errors = [];
  const entries = Array.isArray(review.findings) ? review.findings : [];
  entries.forEach((e, i) => errors.push(...validateReviewEntry(e, i)));
  const dismissedInput = Array.isArray(review.dismissed) ? review.dismissed : [];
  dismissedInput.forEach((d, i) => {
    if (!d || typeof d.id !== 'string') errors.push(`${VISUAL_REVIEW_FILE} dismissed[${i}].id: ID do achado automático (ex.: "F1a2b3c4d").`);
    if (!d || typeof d.reason !== 'string' || d.reason.trim().length < 10) errors.push(`${VISUAL_REVIEW_FILE} dismissed[${i}].reason: todo descarte precisa de motivo (mín. 10 caracteres).`);
    if (d && typeof d.id === 'string') {
      const target = (report.autoFindings || report.findings).find((f) => f.id === d.id);
      if (!target) errors.push(`${VISUAL_REVIEW_FILE} dismissed[${i}]: ID ${d.id} não existe no relatório.`);
      else if (!['visual', 'a11y-seo'].includes(target.layer)) errors.push(`${VISUAL_REVIEW_FILE} dismissed[${i}]: a revisão visual só descarta achados das camadas visual e a11y-seo. ${target.id} é da camada ${target.layer}; use uma exceção com motivo na config.`);
    }
  });
  const reviewed = Array.isArray(review.reviewed) ? review.reviewed : [];
  const expectedPairs = (report.visual?.manifest || []).filter((m) => m.files.length).map((m) => `${m.route}@${m.breakpoint}`);
  const reviewedPairs = new Set(reviewed.flatMap((r) => (Array.isArray(r.breakpoints) ? r.breakpoints : []).map((b) => `${r.route}@${b}`)));
  const missing = expectedPairs.filter((p) => !reviewedPairs.has(p));
  if (missing.length) {
    errors.push(`${VISUAL_REVIEW_FILE} reviewed: faltam capturas sem revisão declarada: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}. Declare {"route": "/x", "breakpoints": [375, 1440]} para cada rota olhada.`);
  }
  if (errors.length) throw new ConfigError(`Revisão visual inválida:\n  - ${errors.join('\n  - ')}`);

  const base = report.autoFindings || report.findings.filter((f) => f.source !== 'revisao-visual');
  const dismissed = [];
  const kept = [];
  for (const f of base) {
    const d = dismissedInput.find((x) => x.id === f.id);
    if (d) dismissed.push({ id: f.id, title: f.title, reason: redactText(d.reason) });
    else kept.push({ ...f });
  }

  const reviewFindings = createFindings();
  for (const e of entries) {
    reviewFindings.add({
      layer: 'visual',
      severity: e.severity,
      title: e.title,
      detail: e.detail || '',
      fix: e.fix || '',
      route: e.route,
      breakpoint: e.breakpoint,
      evidence: e.evidence || [],
      source: 'revisao-visual',
    });
  }

  report.findings = [...kept, ...reviewFindings.all()];
  report.visual = {
    ...report.visual,
    reviewDone: true,
    reviewedAt: new Date().toISOString(),
    reviewNotes: redactText(review.notes || ''),
    dismissed,
  };
  writeReport(runDir, report);
  console.log(`✓ Revisão visual incorporada: ${reviewFindings.all().length} achado(s) novo(s), ${dismissed.length} descartado(s).`);
  console.log(fs.readFileSync(path.join(runDir, 'summary.md'), 'utf8'));
  return report.verdict.exitCode;
}

/* ---------------- run ---------------- */

const LAYER_MODULES = {
  build: () => import('./layers/build.mjs').then((m) => m.runBuild),
  functional: () => import('./layers/functional.mjs').then((m) => m.runFunctional),
  visual: () => import('./layers/visual.mjs').then((m) => m.runVisual),
  'a11y-seo': () => import('./layers/a11y-seo.mjs').then((m) => m.runA11ySeo),
  lgpd: () => import('./layers/lgpd.mjs').then((m) => m.runLgpd),
  performance: () => import('./layers/performance.mjs').then((m) => m.runPerformance),
};

async function cmdRun(args) {
  const projectDir = path.resolve(args.project || process.cwd());
  const { config, exists: configExists, raw } = loadConfig(projectDir, { allowMissing: Boolean(args.url) });
  const mode = resolveMode(args.mode || 'rapido');

  let target = args.target;
  if (target && !['local', 'remote'].includes(target)) throw new ConfigError(`--target "${target}" não existe. Use local ou remote.`);
  if (!target) target = args.url ? (isLocalUrl(args.url) ? 'local' : 'remote') : 'local';
  const baseUrl = (args.url || config.targets[target]?.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) throw new ConfigError(`Sem baseUrl para o alvo "${target}". Preencha targets.${target}.baseUrl em ${CONFIG_FILE} ou use --url.`);

  let layers = args.only ? args.only : [...mode.layers];
  const unknown = layers.filter((l) => !ALL_LAYERS.includes(l));
  if (unknown.length) throw new ConfigError(`Camada(s) desconhecida(s): ${unknown.join(', ')}. Suportadas: ${ALL_LAYERS.join(', ')}.`);
  const notes = [];
  if (target === 'remote' && layers.includes('build')) {
    layers = layers.filter((l) => l !== 'build');
    notes.push('Build não roda contra alvo remoto: o código verificado é o que está publicado.');
  }
  layers = ALL_LAYERS.filter((l) => layers.includes(l));
  if (!configExists) notes.push(`Sem ${CONFIG_FILE}: rodando com padrões. Rode "init" para fixar alvos, budgets e exceções no projeto.`);

  const runDir = ensureDir(path.join(projectDir, RUNS_DIR, `${timestamp()}-${target}-${mode.key}`));
  const log = createLogger(path.join(runDir, 'run.log'));
  const startedAt = new Date();
  const productionLike = target === 'remote' && isProductionLike(baseUrl);
  if (configExists) ensureGitignore(projectDir, [`${RUNS_DIR}/`, ENV_FILE]);

  log.info(`web-qa ${mode.label} em ${baseUrl} (${target}${productionLike ? ', produção' : ''})`);
  log.info(`Camadas: ${layers.map((l) => LAYER_LABEL[l]).join(', ')}`);

  const findings = createFindings();
  const ctx = {
    args,
    projectDir,
    config,
    mode,
    target,
    baseUrl,
    productionLike,
    env: loadEnvFile(projectDir),
    findings,
    runDir,
    log,
    failFast: args.failFast,
    breakpoints: pickBreakpoints(config.breakpoints, mode.breakpoints),
    routes: [],
  };

  const report = {
    schema: 'web-qa/1',
    meta: {
      project: config.project,
      target,
      mode: mode.key,
      modeLabel: mode.label,
      baseUrl,
      productionLike,
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      durationMs: 0,
      node: process.versions.node,
      platform: process.platform,
      routes: [],
      routesSource: '-',
      breakpoints: ctx.breakpoints,
      formFactor: config.performance.formFactor,
      stoppedEarly: false,
      configExists,
    },
    layers: Object.fromEntries(layers.map((l) => [l, { rawStatus: 'nao-executada', durationMs: 0, notes: [], extra: {} }])),
    findings: [],
    suppressed: [],
    exceptions: [],
    budgets: { values: { ...DEFAULT_BUDGETS, ...config.budgets }, loosened: [], reason: raw?.budgets?.reason || null },
    visual: { manifest: [], reviewDone: false, dismissed: [] },
    performance: [],
    notes,
  };
  report.budgets.loosened = Object.entries(DEFAULT_BUDGETS)
    .filter(([k, def]) => typeof raw?.budgets?.[k] === 'number' && raw.budgets[k] > def)
    .map(([k, def]) => `${k} ${raw.budgets[k]} (padrão ${def})`);
  delete report.budgets.values.reason;

  let browser = null;
  let server = null;
  let stop = false;

  const runLayer = async (layer) => {
    const started = Date.now();
    try {
      const fn = await LAYER_MODULES[layer]();
      const result = (await fn(ctx)) || {};
      const { status, notes: layerNotes, results: _results, ...extra } = result;
      report.layers[layer] = { rawStatus: status ?? null, notes: layerNotes || [], extra };
    } catch (err) {
      log.error(`${LAYER_LABEL[layer]}: erro de execução: ${err.message}`);
      report.layers[layer] = { rawStatus: 'erro', notes: [`Erro de execução: ${redactText(err.message.split('\n')[0])}`], extra: {} };
    }
    report.layers[layer].durationMs = Date.now() - started;
  };

  try {
    const reachable = await isReachable(baseUrl);

    if (layers.includes('build')) {
      ctx.serverAlreadyUp = target === 'local' && reachable;
      await runLayer('build');
      if (ctx.failFast && findings.forLayer('build').some((f) => f.severity === 'alto')) {
        stop = true;
        report.meta.stoppedEarly = true;
        notes.push('Build falhou: camadas de navegador não rodaram (fail-fast). Corrija o build ou use --no-fail-fast.');
      }
    }

    const browserLayers = layers.filter((l) => BROWSER_LAYERS.includes(l));
    if (!stop && browserLayers.length) {
      if (!reachable) {
        const serverCfg = config.targets[target]?.server;
        const configuredBase = (config.targets.local?.baseUrl || '').replace(/\/+$/, '');
        // Só sobe o servidor da config se a URL verificada for a mesma da config (um --url avulso não é desse servidor).
        if (target === 'local' && serverCfg?.command && baseUrl === configuredBase) {
          try {
            server = await startServer({ command: serverCfg.command, cwd: projectDir, baseUrl, readyTimeoutMs: config.timeouts.serverReadyMs, log });
          } catch (err) {
            findings.add({
              layer: 'functional',
              severity: 'alto',
              title: 'Servidor local não subiu',
              detail: `${err.message}\n\n${err.output || ''}`,
              fix: /start/.test(serverCfg.command) ? 'O comando de start precisa de um build existente. Rode o modo completo (que faz o build) ou suba o dev server manualmente.' : 'Rode o comando manualmente e veja o erro.',
            });
            stop = true;
          }
        } else {
          findings.add({
            layer: 'functional',
            severity: 'alto',
            title: 'Alvo não responde',
            detail: `${baseUrl} não respondeu.`,
            fix: target === 'local' ? `Suba o servidor (ex.: npm run dev) ou configure targets.local.server.command em ${CONFIG_FILE}.` : 'Confira a URL, DNS, Cloudflare e se o deploy terminou.',
          });
          stop = true;
        }
        if (stop) {
          report.meta.stoppedEarly = true;
          for (const l of browserLayers) report.layers[l] = { rawStatus: 'nao-executada', durationMs: 0, notes: ['Alvo indisponível.'], extra: {} };
          if (report.layers.functional) report.layers.functional.rawStatus = 'falhou';
        }
      }

      if (!stop) {
        browser = await launchBrowser();
        ctx.browser = browser;
        const discovered = await discoverRoutes({ projectDir, baseUrl, config, target, browser, onlyRoutes: args.routes, log });
        ctx.routes = discovered.routes;
        report.meta.routes = discovered.routes;
        report.meta.routesSource = discovered.source;
        notes.push(...discovered.notes);

        for (const layer of browserLayers) {
          if (stop) {
            report.layers[layer] = { rawStatus: 'nao-executada', durationMs: 0, notes: ['Interrompida por fail-fast.'], extra: {} };
            continue;
          }
          log.step(`Camada: ${LAYER_LABEL[layer]}`);
          await runLayer(layer);
          if (ctx.stopAfterLayer) {
            stop = true;
            report.meta.stoppedEarly = true;
          }
        }
        report.visual.manifest = ctx.visualManifest || [];
        report.performance = ctx.performanceResults || [];
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server && !args.keepServer) server.stop();
    else if (server) notes.push('Servidor mantido no ar (--keep-server).');
  }

  // Exceções: aplicadas uma vez, no fim, sobre todos os achados. IDs originais preservados.
  const { kept, suppressed, expiredFindings, exceptionReport } = applyExceptions(findings.all(), config.exceptions);
  const expiredRegistry = createFindings();
  for (const f of expiredFindings) expiredRegistry.add(f);
  report.findings = [...kept, ...expiredRegistry.all()];
  report.autoFindings = report.findings.map((f) => ({ ...f }));
  report.suppressed = suppressed;
  report.exceptions = exceptionReport;

  const finishedAt = new Date();
  report.meta.finishedAt = finishedAt.toISOString();
  report.meta.durationMs = finishedAt - startedAt;
  writeReport(runDir, report);
  fs.writeFileSync(path.join(projectDir, RUNS_DIR, 'latest.txt'), runDir + '\n');

  log.info('');
  log.info(`Resultado: ${report.verdict.text}${report.verdict.caveats.length ? ` (${report.verdict.caveats.join('; ')})` : ''}`);
  for (const [k, l] of Object.entries(report.layers)) log.info(`  ${LAYER_LABEL[k]}: ${l.status} (alto ${l.counts.alto}, médio ${l.counts.medio}, baixo ${l.counts.baixo})`);
  log.info(`Relatório: ${path.join(runDir, 'report.html')}`);
  log.info(`Resumo para leitura: ${path.join(runDir, 'summary.md')}`);
  if (report.visual.manifest.length) log.info(`Revisão visual pendente: screenshots em ${path.join(runDir, 'visual')}`);
  await log.close();
  return report.verdict.exitCode;
}

/* ---------------- main ---------------- */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'run';
  if (args.help || cmd === 'help') {
    console.log(HELP);
    return 0;
  }
  if (cmd === 'init') return cmdInit(args);
  if (cmd === 'doctor') return cmdDoctor();
  if (cmd === 'finalize') return cmdFinalize(args);
  if (cmd === 'run') return cmdRun(args);
  throw new ConfigError(`Comando desconhecido: ${cmd}. Veja --help.`);
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    if (err instanceof ConfigError) console.error(`✗ ${err.message}`);
    else console.error(`✗ Erro inesperado: ${err.stack || err.message}`);
    process.exit(2);
  });
