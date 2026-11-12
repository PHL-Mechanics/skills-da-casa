/**
 * motion.ts — O Sistema de Movimento.
 *
 * Fonte única de verdade para tempo e easing do projeto inteiro.
 * Regra: NENHUM número mágico de duração/ease espalhado em componente.
 * Tudo puxa daqui. Assim o "refinamento artístico" vira determinístico,
 * não algo revisado no olho no final.
 *
 * Filosofia: cinematográfico = lento com intenção. Nada abaixo de 0.6s.
 * Só easings da família `power` ou `expo` (sobriedade > efeito gimmick).
 */

// ──────────────────────────────────────────────────────────────
// DURATIONS (segundos)
// ──────────────────────────────────────────────────────────────
export const DURATION = {
  /** 0.6 — mínimo absoluto. Abaixo disso não é cinematográfico, é pressa. */
  fast: 0.6,
  /** 0.9 — reveals padrão de texto e imagem. */
  base: 0.9,
  /** 1.2 — heros, entradas de seção, momentos de respiro. */
  slow: 1.2,
  /** 1.8 — transições-âncora, "momentos de câmera". */
  epic: 1.8,
} as const;

// ──────────────────────────────────────────────────────────────
// EASES — a "assinatura" do movimento
// ──────────────────────────────────────────────────────────────
export const EASE = {
  /** power3.out — o padrão. Entrada decidida que desacelera com graça. */
  out: 'power3.out',
  /** power3.inOut — para movimentos que vão e voltam (pin, câmera). */
  inOut: 'power3.inOut',
  /** expo.out — reveals dramáticos, alto contraste de velocidade. */
  expo: 'expo.out',
  /** power2.out — micro-interações sutis (hover, botões). */
  soft: 'power2.out',
} as const;

// ──────────────────────────────────────────────────────────────
// STAGGER — intervalo entre elementos em sequência
// ──────────────────────────────────────────────────────────────
export const STAGGER = {
  /** 0.15 — sequências densas (listas, grids). */
  tight: 0.15,
  /** 0.2 — sequências cinematográficas (linhas de texto, cards de destaque). */
  cinematic: 0.2,
} as const;

// ──────────────────────────────────────────────────────────────
// PRESETS de reveal — vars prontas para gsap.from()
// ──────────────────────────────────────────────────────────────

/** Reveal de texto: sobe de baixo com mask de opacidade. Use em headlines. */
export const revealUp = {
  y: 40,
  opacity: 0,
  duration: DURATION.slow,
  ease: EASE.expo,
} as const;

/** Reveal suave de imagem/bloco. */
export const revealFade = {
  y: 24,
  opacity: 0,
  duration: DURATION.base,
  ease: EASE.out,
} as const;

/** Escala sutil (zoom de câmera) para mídia em destaque. */
export const revealScale = {
  scale: 1.08,
  opacity: 0,
  duration: DURATION.slow,
  ease: EASE.out,
} as const;

/**
 * Helper: respeita prefers-reduced-motion.
 * Em "reduce", devolve duração ~0 para o elemento só aparecer, sem movimento.
 */
export const reduce = (vars: Record<string, unknown>) => {
  const prefersReduce =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return prefersReduce ? { ...vars, duration: 0.01, y: 0, scale: 1 } : vars;
};

export type Duration = keyof typeof DURATION;
export type Ease = keyof typeof EASE;
