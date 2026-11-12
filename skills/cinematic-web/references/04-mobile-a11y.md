# 04 — Domando o Caos Mobile & Acessibilidade

Animações cinematográficas quebram no mobile **por design, não por azar**: pins pesados, parallax que disputa com o gesto de toque, e o conflito clássico Lenis↔ScrollTrigger. A regra de ouro desta fase: **corrigir o mobile sem tocar na estética do desktop.**

## 1. `gsap.matchMedia()` — desktop ≠ mobile sem `if` espalhado

Em vez de espalhar `if (window.innerWidth > 768)` pelo código (que não reage a resize e não limpa sozinho), declare animações por contexto de media query. O GSAP **monta e desmonta** cada contexto automaticamente quando a query muda.

```tsx
'use client';
import { useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { DURATION, EASE, STAGGER } from '@/lib/motion';

gsap.registerPlugin(ScrollTrigger, useGSAP);

export function Secao() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      // DESKTOP: a experiência completa, com pin e scrub.
      mm.add('(min-width: 768px)', () => {
        const tl = gsap.timeline({
          scrollTrigger: { trigger: root.current, start: 'top top', end: '+=1500', pin: true, scrub: 1 },
        });
        tl.from('.cena', { opacity: 0, scale: 1.1, ease: EASE.inOut, stagger: STAGGER.cinematic });
        // cleanup específico deste contexto (opcional — o matchMedia já reverte):
        return () => {};
      });

      // MOBILE: sem pin, sem scrub pesado. Só reveals leves na entrada.
      mm.add('(max-width: 767px)', () => {
        gsap.from('.cena', {
          y: 30,
          opacity: 0,
          duration: DURATION.base,
          ease: EASE.out,
          stagger: STAGGER.tight,
          scrollTrigger: { trigger: root.current, start: 'top 75%' },
        });
      });

      // REDUCED MOTION: praticamente sem movimento (ver seção 2).
      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set('.cena', { opacity: 1, y: 0, scale: 1 });
      });
    },
    { scope: root },
  );

  return <section ref={root}>{/* .cena ... */}</section>;
}
```

> **Por que não só CSS media query?** Porque a animação em si (com pin/scrub) precisa **não existir** no mobile, não apenas estar escondida. `matchMedia` garante que o `ScrollTrigger` nem é criado fora do contexto — zero custo e zero conflito.

## 2. `prefers-reduced-motion` (acessibilidade não é opcional)

Parte dos usuários sente enjoo/vertigem com movimento (vestibular). Ignorar isso é problema de acessibilidade **e** risco legal (WCAG). Em "reduce": desligue smooth scroll, pins e parallax — deixe só o conteúdo aparecer.

- O `lenis-provider.tsx` já desliga o `smoothWheel` em `reduce`.
- Em cada componente, use o contexto `(prefers-reduced-motion: reduce)` do `matchMedia` para zerar deslocamentos (como acima).
- Helper pronto: `reduce(vars)` em `motion.ts`.

## 3. Conflito Lenis ↔ ScrollTrigger (o bug que "some e volta")

Sintomas no mobile: scroll travando, animações pulando, scrub trêmulo. Checklist de diagnóstico:

1. **Há dois loops de RAF?** Confirme que Lenis roda **só** pelo `gsap.ticker` (como no provider). Procure por `lenis.raf` chamado também dentro de um `requestAnimationFrame` próprio → remova um.
2. **Smooth scroll em touch?** Lenis em touch costuma brigar com o scroll nativo. Avalie `smoothTouch: false` (deixe o toque nativo, mantenha o smooth só no wheel/desktop).
3. **Pins sobrepostos no mobile?** Remova-os via `matchMedia` (seção 1).
4. **Altura mudou após carregar?** Chame `ScrollTrigger.refresh()` depois de fontes/imagens/vídeo carregarem.

```ts
// Exemplo: smooth só onde faz sentido
const lenis = new Lenis({
  duration: 1.2,
  smoothWheel: true,
  // em muitos projetos, deixar o toque nativo evita 90% dos bugs mobile:
  // (a propriedade exata depende da versão do Lenis — verifique a doc instalada)
});
```

## 4. Performance no mobile

- **Anime só `transform` e `opacity`.** `width`, `height`, `top`, `left`, `margin` causam reflow e derrubam o framerate. `x`/`y`/`scale`/`rotate` rodam na GPU.
- **`will-change` com parcimônia.** Aplique só nos elementos realmente animados e remova depois — `will-change` em tudo estoura memória.
- **Vídeo de fundo no mobile:** considere trocar por imagem (`poster`) abaixo de 768px — vídeo autoplay consome bateria/dados e às vezes nem toca.
- **Menos triggers.** Cada `ScrollTrigger` com `scrub` recalcula no frame. No mobile, prefira reveals simples por entrada (`toggleActions`) a múltiplos scrubs.
- **`fastScrollEnd: true`** nos triggers ajuda em scroll rápido por toque.

## 5. Como debugar (mande a IA analisar, não conserte na mão)

Prompt que funciona quando algo quebra: *"A animação GSAP está instável no mobile. Leia o CLAUDE.md, verifique conflitos entre Lenis e ScrollTrigger (RAF duplo, smooth no touch, pins sobrepostos) e ajuste a performance via `gsap.matchMedia()` SEM alterar a estética do desktop."*

Ferramenta visual: `ScrollTrigger.create({ markers: true })` (ou `markers: true` no trigger) mostra start/end na tela — ótimo para ver triggers "fora de hora". Remova os markers antes de entregar.
