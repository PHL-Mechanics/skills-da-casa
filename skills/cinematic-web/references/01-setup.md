# 01 — Setup do Stack & Integração

A fundação. Faça isto **antes** de gerar qualquer componente. Ordem importa: a fundação errada contamina todas as animações depois.

## 1. Projeto novo (Next + Tailwind)

```bash
npx create-next-app@latest meu-projeto --typescript --tailwind --app --eslint
cd meu-projeto
npm i gsap @gsap/react lenis
```

Em projeto existente, só o `npm i gsap @gsap/react lenis`.

> **Nota GSAP:** desde a aquisição pela Webflow, GSAP e todos os plugins (incluindo ScrollTrigger, SplitText etc.) são **gratuitos**, sem registro de Club. Importe direto de `gsap/...`.

## 2. Copiar os arquivos de fundação

Copie da skill para o projeto:

- `assets/lib/motion.ts` → `lib/motion.ts`
- `assets/lib/lenis-provider.tsx` → `lib/lenis-provider.tsx`
- `assets/CLAUDE.md` → `CLAUDE.md` (raiz) — e preencha.

## 3. Plugar o Lenis no root layout

```tsx
// app/layout.tsx
import { LenisProvider } from '@/lib/lenis-provider';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <LenisProvider>{children}</LenisProvider>
      </body>
    </html>
  );
}
```

## 4. A integração canônica (entenda o porquê)

O provider já faz isto, mas saiba o que está acontecendo:

```ts
gsap.registerPlugin(ScrollTrigger);

const lenis = new Lenis({ duration: 1.2 });

// (1) Lenis dispara → ScrollTrigger recalcula posições.
lenis.on('scroll', ScrollTrigger.update);

// (2) O ticker do GSAP é o ÚNICO relógio. Ele dirige o raf do Lenis.
//     Sem isso, Lenis e ScrollTrigger correm em RAFs diferentes → scrub trêmulo.
gsap.ticker.add((time) => lenis.raf(time * 1000)); // s → ms

// (3) lagSmoothing(0) faz o scrub acompanhar o dedo sem "alisar" demais.
gsap.ticker.lagSmoothing(0);
```

**Por que não dois `requestAnimationFrame`?** Porque cada um teria seu próprio timestamp. O ScrollTrigger leria a posição em um quadro e o Lenis a moveria em outro → desalinhamento de subpixel a cada frame = tremor (jitter) visível no `scrub`.

## 5. Padrão de animação em React (`useGSAP`)

**Sempre** use `useGSAP` com `scope`. Ele roda dentro de um `gsap.context` e faz `revert()` no unmount — sem isso, ao trocar de rota no Next as animações vazam e duplicam.

```tsx
'use client';
import { useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { revealUp, STAGGER } from '@/lib/motion';

gsap.registerPlugin(ScrollTrigger, useGSAP);

export function Secao() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.from('.reveal', {
        ...revealUp,
        stagger: STAGGER.cinematic,
        scrollTrigger: { trigger: root.current, start: 'top 70%' },
      });
    },
    { scope: root }, // seletores ('.reveal') ficam restritos a este container
  );

  return (
    <div ref={root}>
      <h2 className="reveal">Linha 1</h2>
      <p className="reveal">Linha 2</p>
    </div>
  );
}
```

## 6. Gotchas de SSR / Next (os que mais pegam)

- **`"use client"`** em todo componente que usa GSAP/Lenis/ScrollTrigger — eles tocam `window`/`document`.
- **Registrar o plugin** em cada arquivo que o usa: `gsap.registerPlugin(ScrollTrigger, useGSAP)`. É idempotente, pode repetir.
- **`ScrollTrigger.refresh()`** após carregar fontes web ou imagens sem dimensão fixa — a altura da página muda e os triggers ficam no lugar errado. Em geral o provider + `useGSAP` cuidam, mas force refresh se ver triggers "fora de hora".
- Evite animar elementos que só existem após hidratação sem checar o ref.

## 7. Portabilidade (HTML puro / WordPress / LearnWorlds)

O núcleo é o mesmo; muda só o carregamento.

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/ScrollTrigger.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/lenis@1/dist/lenis.min.js"></script>
<script>
  gsap.registerPlugin(ScrollTrigger);
  const lenis = new Lenis({ duration: 1.2 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
</script>
```

- **WordPress/Divi & LearnWorlds:** mantenha os mesmos tokens de duration/ease. **Prefixe** todas as classes/IDs (ex.: `psx-hero`, `psx-reveal`) para não vazar estilo nem colidir com o tema/plataforma. Escopo de CSS rígido — nada de seletores genéricos como `.hero h1`.
- Se a plataforma já tiver smooth scroll próprio, **escolha um** (Lenis ou o nativo) — nunca os dois ao mesmo tempo.
