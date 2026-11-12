import { spawn, spawnSync } from 'node:child_process';
import { tailLines } from './util.mjs';

export async function isReachable(url, timeoutMs = 5000) {
  try {
    await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

export async function startServer({ command, cwd, baseUrl, readyTimeoutMs, env = {}, log }) {
  log?.step(`Subindo servidor: ${command}`);
  const isWin = process.platform === 'win32';
  let output = '';
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: !isWin,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env, FORCE_COLOR: '0', BROWSER: 'none' },
  });
  const collect = (chunk) => {
    output += chunk.toString();
    if (output.length > 200000) output = output.slice(-100000);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  let exited = null;
  child.on('exit', (code) => {
    exited = code ?? 0;
  });

  const started = Date.now();
  while (Date.now() - started < readyTimeoutMs) {
    if (exited !== null) {
      const err = new Error(`O servidor encerrou antes de responder (código ${exited}).`);
      err.output = tailLines(output, 40);
      throw err;
    }
    if (await isReachable(baseUrl, 3000)) {
      log?.ok(`Servidor respondendo em ${baseUrl} (${Math.round((Date.now() - started) / 1000)} s)`);
      return {
        child,
        stop: () => stopProcess(child),
        output: () => tailLines(output, 40),
      };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  stopProcess(child);
  const err = new Error(`O servidor não respondeu em ${Math.round(readyTimeoutMs / 1000)} s em ${baseUrl}.`);
  err.output = tailLines(output, 40);
  throw err;
}

export function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-child.pid, 'SIGTERM');
      setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // já encerrado
        }
      }, 3000).unref();
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // já encerrado
    }
  }
}
