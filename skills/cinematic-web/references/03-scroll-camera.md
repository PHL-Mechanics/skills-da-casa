# 03 — Scroll com "Olhar de Câmera"

Onde o site vira filme. O scroll deixa de ser "descer a página" e vira **movimento de câmera**: elementos entram em sequência, cenas ficam fixas enquanto a ação acontece, planos se movem em profundidades diferentes. O segredo é o **scroll controlado** (`scrub`) — o tempo da animação segue o dedo do usuário, não um relógio.

## Conceitos-chave do ScrollTrigger

- **`trigger`** — o elemento que dispara.
- **`start` / `end`** — `'top 70%'` = quando o topo do trigger cruza 70% da viewport. `'+=600'` = 600px depois do start.
- **`scrub`** — atrela o progresso da animação ao scroll. `true` = colado; `1` = com 1s de "atraso" suave (ainda mais cinematográfico).
- **`pin`** — fixa o elemento na tela enquanto o trigger é percorrido.
- **`toggleActions`** — `'play none none reverse'` para entradas que revertem ao voltar.

## A) Reveal em sequência (o pão com manteiga)

```tsx
useGSAP(() => {
  gsap.from('.reveal', {
    y: 40,
    opacity: 0,
    duration: 0.9,           // → DURATION.base
    ease: 'power3.out',      // → EASE.out
    stagger: 0.2,            // → STAGGER.cinematic
    scrollTrigger: {
      trigger: root.current,
      start: 'top 70%',
      toggleActions: 'play none none reverse',
    },
  });
}, { scope: root });
```

Cada `.reveal` entra 0.2s depois do anterior, em `power3.out`, como uma câmera revelando o plano. Importe os valores de `motion.ts` — aqui estão crus só para leitura.

## B) Pin scroll (a cena que segura)

Fixa uma seção e anima o conteúdo enquanto o usuário percorre uma "distância" de scroll. O `scrub` faz o tempo da timeline = posição do scroll.

```tsx
useGSAP(() => {
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: root.current,
      start: 'top top',
      end: '+=1500',        // 1500px de scroll = duração da cena
      pin: true,            // segura a seção na tela
      scrub: 1,             // 1s de suavização → movimento de câmera
    },
  });

  tl.from('.cena-1', { opacity: 0, scale: 1.1, ease: 'power3.inOut' })
    .from('.cena-2', { yPercent: 30, opacity: 0, ease: 'power3.inOut' }, '+=0.2')
    .to('.cena-1',   { opacity: 0, ease: 'power3.inOut' }, '<');
}, { scope: root });
```

> Use `scrub: 1` (não `true`) para o "peso" de câmera. O número é o tempo de catch-up em segundos — quanto maior, mais a animação "desliza" atrás do scroll.

## C) Parallax (profundidade)

Planos a velocidades diferentes criam profundidade. Fundo se move menos que o conteúdo.

```tsx
useGSAP(() => {
  gsap.to('.camada-fundo', {
    yPercent: -20,          // fundo sobe devagar
    ease: 'none',           // parallax é linear de propósito
    scrollTrigger: {
      trigger: root.current,
      start: 'top bottom',
      end: 'bottom top',
      scrub: true,
    },
  });
}, { scope: root });
```

> **Exceção à regra do ease:** parallax atrelado a `scrub` usa `ease: 'none'`. Aqui o "ease" real vem do Lenis (a inércia do scroll). Easing duplo deixaria o parallax elástico e enjoativo.

## D) Scroll horizontal (galeria-câmera)

Empurra uma faixa horizontal conforme o scroll vertical avança. Ótimo para portfólios/cases.

```tsx
useGSAP(() => {
  const faixa = root.current!.querySelector('.faixa') as HTMLElement;
  const distancia = faixa.scrollWidth - window.innerWidth;

  gsap.to(faixa, {
    x: -distancia,
    ease: 'none',
    scrollTrigger: {
      trigger: root.current,
      start: 'top top',
      end: () => `+=${distancia}`,  // função → recalcula no refresh
      pin: true,
      scrub: 1,
      invalidateOnRefresh: true,
    },
  });
}, { scope: root });
```

> `end` como **função** + `invalidateOnRefresh: true` = recalcula a distância quando a viewport muda (resize, rotação). Sem isso, quebra ao redimensionar.

## Princípios de "olhar de câmera"

- **Sequência, não simultaneidade.** Elementos entram um a um (`stagger`/`+=`), como planos revelados.
- **`scrub` para tudo que acompanha o scroll**, animação por tempo só para o que dispara e roda sozinho (ex.: reveal de entrada).
- **Respiro.** Deixe vazios entre cenas — o pin segura, o vazio respira.
- **Uma câmera por vez.** Não empilhe três pins concorrendo na mesma viewport; confunde.

## Erros comuns

- `pin: true` sem espaço suficiente de `end` → a seção "pula".
- Esquecer `invalidateOnRefresh` em medidas calculadas (`scrollWidth`, `innerWidth`) → quebra no resize.
- Animar `top`/`left` em vez de `x`/`y`/`transform` → reflow, perde frames.
- Muitos triggers com `scrub` sem `will-change` → ver `04-mobile-a11y.md` para performance.
