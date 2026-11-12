'use client';

/**
 * lenis-provider.tsx — Scroll suave (Lenis) integrado ao GSAP/ScrollTrigger.
 *
 * A REGRA DE OURO em código:
 *   - Lenis  → cuida do scroll suave (a inércia).
 *   - GSAP   → move os elementos.
 *   - ScrollTrigger → orquestra quando cada animação dispara.
 *
 * O ponto crítico (causa nº1 de scrub trêmulo): Lenis e ScrollTrigger
 * DEVEM compartilhar o MESMO loop de tempo. Por isso NÃO usamos
 * requestAnimationFrame solto — deixamos o gsap.ticker dirigir o raf
 * do Lenis. Fonte única de tempo = sem jitter.
 *
 * Next.js (App Router): envolva o conteúdo no <LenisProvider> dentro do
 * root layout. Como usa hooks e o objeto window, é "use client".
 *
 * Instalação:  npm i lenis gsap @gsap/react
 */

import { useEffect, useRef, type ReactNode } from 'react';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

type LenisProviderProps = {
  children: ReactNode;
  /** Override opcional das opções do Lenis. */
  options?: ConstructorParameters<typeof Lenis>[0];
};

export function LenisProvider({ children, options }: LenisProviderProps) {
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    // Respeita usuários que pedem menos movimento: desliga o smooth scroll.
    const prefersReduce = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    const lenis = new Lenis({
      // duration alta = scroll com "peso" cinematográfico.
      duration: 1.2,
      // easing exponencial: desacelera com graça no fim do gesto.
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: !prefersReduce,
      ...options,
    });
    lenisRef.current = lenis;

    // 1) A cada scroll do Lenis, atualiza o ScrollTrigger.
    lenis.on('scroll', ScrollTrigger.update);

    // 2) O ticker do GSAP dirige o raf do Lenis (fonte única de tempo).
    //    gsap usa segundos; lenis.raf espera milissegundos → *1000.
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);

    // 3) Desliga o lag smoothing do GSAP para o scrub acompanhar o dedo.
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tick);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [options]);

  return <>{children}</>;
}

/**
 * Hook utilitário para acessar a instância do Lenis em qualquer lugar
 * (ex.: âncoras com scroll suave: lenis.scrollTo('#contato')).
 * Mantenha-o simples; se precisar de acesso global, exponha via context.
 */
export function useLenisScrollTo() {
  return (target: string | number | HTMLElement, offset = 0) => {
    // @ts-expect-error — Lenis registra a instância globalmente em dev se desejado;
    // em produção, prefira passar a instância via context.
    window.__lenis?.scrollTo(target, { offset });
  };
}
