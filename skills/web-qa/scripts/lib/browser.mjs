import fs from 'node:fs';
import { chromium } from 'playwright';

// QA_CHROME_PATH permite apontar para um Chrome/Chromium já instalado
// (útil em CI ou quando o download do Playwright é bloqueado).
export function chromeExecutablePath() {
  if (process.env.QA_CHROME_PATH) return process.env.QA_CHROME_PATH;
  try {
    return chromium.executablePath();
  } catch {
    return null;
  }
}

export function extraChromeArgs() {
  return (process.env.QA_CHROME_ARGS || '')
    .split(/\s+/)
    .map((a) => a.trim())
    .filter(Boolean);
}

export async function launchBrowser() {
  const executablePath = process.env.QA_CHROME_PATH || undefined;
  if (executablePath && !fs.existsSync(executablePath)) {
    throw new Error(`QA_CHROME_PATH aponta para um arquivo que não existe: ${executablePath}`);
  }
  return chromium.launch({
    headless: true,
    executablePath,
    args: extraChromeArgs(),
  });
}

export function browserInstalled() {
  const p = chromeExecutablePath();
  return Boolean(p && fs.existsSync(p));
}
