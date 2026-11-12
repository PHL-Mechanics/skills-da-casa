import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readPackageJson } from '../lib/config.mjs';
import { ensureDir, formatMs, tailLines } from '../lib/util.mjs';

function detectPackageManager(projectDir) {
  if (fs.existsSync(path.join(projectDir, 'pnpm-lock.yaml'))) return { run: 'pnpm run', exec: 'pnpm exec' };
  if (fs.existsSync(path.join(projectDir, 'yarn.lock'))) return { run: 'yarn', exec: 'yarn' };
  if (fs.existsSync(path.join(projectDir, 'bun.lockb')) || fs.existsSync(path.join(projectDir, 'bun.lock'))) return { run: 'bun run', exec: 'bunx' };
  return { run: 'npm run', exec: 'npx' };
}

export function detectBuildCommands(projectDir, scope) {
  const pkg = readPackageJson(projectDir);
  if (!pkg) return [];
  const scripts = pkg.scripts || {};
  const pm = detectPackageManager(projectDir);
  const cmds = [];

  if (scripts.typecheck) cmds.push({ label: 'Tipos', command: `${pm.run} typecheck`, kind: 'typecheck' });
  else if (scripts['type-check']) cmds.push({ label: 'Tipos', command: `${pm.run} type-check`, kind: 'typecheck' });
  else if (fs.existsSync(path.join(projectDir, 'tsconfig.json'))) cmds.push({ label: 'Tipos', command: `${pm.exec} tsc --noEmit`, kind: 'typecheck' });

  if (scripts.lint) cmds.push({ label: 'Lint', command: `${pm.run} lint`, kind: 'lint' });

  if (scope === 'full' && scripts.build) cmds.push({ label: 'Build', command: `${pm.run} build`, kind: 'build' });
  return cmds;
}

function configuredCommands(config, scope) {
  const cmds = config.build?.commands;
  if (cmds === null || cmds === undefined) return null;
  const list = Array.isArray(cmds) ? cmds : cmds[scope] || [];
  return list.map((command) => ({
    label: command,
    command,
    kind: /\bbuild\b/.test(command) ? 'build' : /\blint\b/.test(command) ? 'lint' : /tsc|typecheck|type-check/.test(command) ? 'typecheck' : 'custom',
  }));
}

function runCommand(command, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = '';
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '1', FORCE_COLOR: '0', NEXT_TELEMETRY_DISABLED: '1' },
    });
    const collect = (c) => {
      output += c.toString();
      if (output.length > 2_000_000) output = output.slice(-1_000_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      output += `\n[web-qa] Timeout de ${formatMs(timeoutMs)} atingido. Processo encerrado.`;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output, durationMs: Date.now() - started });
    });
  });
}

const FIX_HINT = {
  typecheck: 'Corrija os erros de tipo apontados. Não use "as any", @ts-ignore ou afrouxe o tsconfig para passar.',
  lint: 'Corrija as regras apontadas. Desabilitar regra ou arquivo no ESLint é uma exceção de arquitetura e precisa ser justificado.',
  build: 'O build de produção quebra o deploy. Corrija antes de qualquer outra verificação.',
  custom: 'Verifique a saída do comando.',
};

export async function runBuild(ctx) {
  const { projectDir, config, mode, findings, runDir, log, serverAlreadyUp } = ctx;
  const scope = mode.buildScope;
  const configured = configuredCommands(config, scope);
  let commands = configured ?? detectBuildCommands(projectDir, scope);
  const notes = [];

  if (!commands.length) {
    return {
      status: 'pulada',
      notes: [configured ? `build.commands não define comandos para o escopo "${scope}" em qa.config.json.` : 'Nenhum comando de tipos, lint ou build encontrado no package.json.'],
    };
  }

  if (serverAlreadyUp && commands.some((c) => c.kind === 'build')) {
    commands = commands.filter((c) => c.kind !== 'build');
    notes.push('Build de produção pulado: já existe um servidor rodando no alvo local e "next build" sobrescreve a pasta .next do dev server. Pare o servidor ou rode com o alvo remoto para validar o build.');
  }

  const logsDir = ensureDir(path.join(runDir, 'logs'));
  let failed = false;

  for (const [i, cmd] of commands.entries()) {
    log.step(`${cmd.label}: ${cmd.command}`);
    const result = await runCommand(cmd.command, projectDir, config.timeouts.buildMs);
    const logFile = path.join(logsDir, `build-${i + 1}-${cmd.kind}.log`);
    fs.writeFileSync(logFile, result.output, 'utf8');

    if (result.code !== 0) {
      failed = true;
      log.error(`${cmd.label} falhou (${formatMs(result.durationMs)})`);
      findings.add({
        layer: 'build',
        severity: 'alto',
        title: `${cmd.label} falhou`,
        detail: `Comando: ${cmd.command}\nCódigo de saída: ${result.code}\n\n${tailLines(result.output, 50)}`,
        fix: FIX_HINT[cmd.kind],
        evidence: [path.relative(runDir, logFile).split(path.sep).join('/')],
        groupKey: cmd.command,
      });
      if (ctx.failFast) break;
    } else {
      log.ok(`${cmd.label} ok (${formatMs(result.durationMs)})`);
      const warnings = (result.output.match(/^\s*(\d+:\d+\s+)?warning\b/gim) || []).length;
      if (cmd.kind === 'lint' && warnings > 0) {
        findings.add({
          layer: 'build',
          severity: 'baixo',
          title: 'Lint com avisos',
          detail: `${warnings} aviso(s) no lint. Veja o log completo.`,
          fix: 'Avisos não quebram o deploy, mas acumulam. Resolva quando tocar nesses arquivos.',
          evidence: [path.relative(runDir, logFile).split(path.sep).join('/')],
        });
      }
    }
  }

  return { status: failed ? 'falhou' : null, notes, commands: commands.map((c) => c.command) };
}
