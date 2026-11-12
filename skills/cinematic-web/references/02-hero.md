# 02 — O Hero Cinematográfico

A primeira impressão define o tom. O objetivo é **criar tensão visual antes que o usuário interaja**: fullscreen, vídeo vivo ao fundo, texto que surge com peso, e um convite sutil para descer que some assim que ele desce.

## Anatomia

1. **Vídeo em loop no background** — `autoplay muted loop playsInline`, com `object-cover`, fallback de imagem (`poster`) e overlay escuro para legibilidade.
2. **Texto com reveal em sequência** — entra com mask (`overflow-hidden` no wrapper + `y` no filho), `slow` + `expo.out`, `stagger` cinematográfico.
3. **Indicador de scroll** — aparece em repouso, **desaparece** quando o usuário começa a descer.

## Receita completa

```tsx
'use client';
import { useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import { DURATION, EASE, STAGGER } from '@/lib/motion';

gsap.registerPlugin(ScrollTrigger, useGSAP);

export function Hero() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      // (1) Reveal do texto em sequência. Cada linha sobe de trás de uma mask.
      const tl = gsap.timeline({ defaults: { ease: EASE.expo } });
      tl.from('.hero-line', {
        yPercent: 120,        // sai de baixo da mask
        duration: DURATION.slow,
        stagger: STAGGER.cinematic,
        delay: 0.2,
      });

      // (2) Indicador de scroll some quando o usuário começa a descer.
      gsap.to('.hero-scroll-hint', {
        opacity: 0,
        y: 10,
        duration: DURATION.fast,
        ease: EASE.soft,
        scrollTrigger: {
          trigger: root.current,
          start: 'top top',
          end: '+=120',       // nos primeiros 120px de scroll
          scrub: true,
        },
      });

      // (3) (opcional) leve parallax/zoom no vídeo ao descer = respiração.
      gsap.to('.hero-media', {
        scale: 1.1,
        ease: 'none',
        scrollTrigger: {
          trigger: root.current,
          start: 'top top',
          end: 'bottom top',
          scrub: true,
        },
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} className="relative h-screen w-full overflow-hidden">
      {/* Vídeo de fundo + overlay */}
      <video
        className="hero-media absolute inset-0 h-full w-full object-cover"
        autoPlay
        muted
        loop
        playsInline
        poster="/hero-fallback.jpg"
      >
        <source src="/hero.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-black/50" />

      {/* Texto com mask por linha */}
      <div className="relative z-10 flex h-full flex-col justify-center px-8">
        <h1 className="text-6xl font-semibold text-white">
          <span className="block overflow-hidden">
            <span className="hero-line block">Movimento</span>
          </span>
          <span className="block overflow-hidden">
            <span className="hero-line block">com intenção.</span>
          </span>
        </h1>
      </div>

      {/* Indicador de scroll */}
      <div className="hero-scroll-hint absolute bottom-8 left-1/2 z-10 -translate-x-1/2 text-white/70">
        <span className="text-sm tracking-widest">ROLE</span>
      </div>
    </section>
  );
}
```

## Por que assim

- **Mask por linha** (`overflow-hidden` no pai + `yPercent` no filho) dá o efeito clássico de texto "subindo de dentro" — muito mais cinematográfico que um `fade` simples.
- **`expo.out`** no reveal cria o contraste de velocidade dramático: entra rápido, assenta devagar.
- **Indicador com `scrub`** atrelado ao próprio scroll: não é um timer, ele responde ao gesto — some na medida em que o usuário desce.
- **Zoom sutil no vídeo** (`scale` 1 → 1.1) adiciona profundidade sem distrair.

## Variações

- **Sem vídeo:** troque por imagem com o mesmo zoom de parallax — mantém a sensação de câmera.
- **SplitText** (grátis no GSAP atual): para revelar **palavra a palavra** ou **caractere a caractere**, use `SplitText` e aplique o stagger nos pedaços. Reserve para headlines curtas — caractere a caractere em parágrafo longo polui.
- **Reduced motion:** no `useGSAP`, cheque `gsap.matchMedia('(prefers-reduced-motion: reduce)')` e nesse caso só faça `opacity` 0→1 sem deslocamento (ver `04-mobile-a11y.md`).

## Erros comuns

- Vídeo sem `muted` + `playsInline` → não dá autoplay (principalmente iOS).
- Vídeo pesado sem `poster` → tela preta no carregamento. Sempre fallback.
- Texto sem `overflow-hidden` no wrapper → a mask não funciona e o `yPercent` vaza para fora.
