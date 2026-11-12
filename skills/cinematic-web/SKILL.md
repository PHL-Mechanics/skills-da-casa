---
name: cinematic-web
description: >-
  Construir interfaces web cinematográficas e scroll-driven com Next.js + Tailwind + GSAP + ScrollTrigger + Lenis,
  com movimento "intencional" (lento, fluido, com cara de filme) em vez de transições genéricas. Use esta skill
  SEMPRE que o pedido envolver: scroll suave (smooth scroll / Lenis), animações de scroll (ScrollTrigger, pin,
  parallax, reveal, scrub, stagger), hero cinematográfico com vídeo de fundo, "site com cara de filme / cinematic",
  "movimento de câmera no scroll", GSAP em React/Next, ou qualquer pedido para deixar uma landing page "mais fluida",
  "mais elegante", "mais premium" no quesito movimento. Use também quando for criar o CLAUDE.md / a "bíblia" de um
  projeto front-end de animação, ou quando uma animação GSAP estiver "quebrando/instável no mobile". Não use para
  CSS/layout estático sem movimento, nem para dashboards de dados — aqui o foco é MOVIMENTO com intenção.
---

# Cinematic Web — Movimento com Intenção

Skill para construir experiências web **cinematográficas**: sites que parecem um filme, onde o scroll é uma câmera e cada elemento entra com tempo, peso e elegância. O stack-base é **Next.js + Tailwind + GSAP + ScrollTrigger + Lenis**, mas o núcleo (o *sistema de movimento*) é portável para HTML/CSS puro, WordPress/Divi e LearnWorlds.

> **Filosofia central:** sites cinematográficos **não são rápidos — são lentos com intenção.** A pressa é inimiga da elegância. Antes de qualquer linha de código, o movimento é decidido; o código só obedece.

---

## A Regra de Ouro (a lei que nunca se quebra)

Três bibliotecas, três responsabilidades. Misturar isso é a causa nº 1 de scroll trêmulo e bug no mobile:

| Biblioteca | Responsabilidade ÚNICA | Nunca faz |
|---|---|---|
| **Lenis** | Scroll suave (a inércia, o "peso" do scroll) | Não anima elementos |
| **GSAP** | O movimento dos elementos (posição, opacidade, escala) | Não controla o scroll da página |
| **ScrollTrigger** | A orquestração — quando/como cada animação dispara no scroll | Não roda seu próprio loop de scroll |

E o detalhe que separa amador de profissional: **Lenis e ScrollTrigger precisam compartilhar o mesmo loop de tempo (`gsap.ticker`).** Se rodarem em RAFs separados, o `scrub` fica trêmulo (jitter). A integração canônica está em `assets/lib/lenis-provider.tsx` — **sempre** use esse padrão, nunca dois `requestAnimationFrame` soltos.

```ts
// O coração da integração (detalhes completos em references/01-setup.md):
lenis.on('scroll', ScrollTrigger.update);          // Lenis avisa o ScrollTrigger a cada scroll
gsap.ticker.add((time) => lenis.raf(time * 1000)); // GSAP dirige o RAF do Lenis (fonte única de tempo)
gsap.ticker.lagSmoothing(0);
```

---

## O Sistema de Movimento (tokens, não improviso)

O "refinamento artístico" não é revisado no olho no final — ele é **imposto desde o início** por tokens centralizados em `assets/lib/motion.ts`. Toda animação puxa daqui. Isso torna o refino determinístico.

**Durations canônicos** (em segundos):

| Token | Valor | Para |
|---|---|---|
| `fast` | 0.6 | o mínimo absoluto. **Nada cinematográfico fica abaixo de 0.6s.** |
| `base` | 0.9 | reveals padrão de texto e imagem |
| `slow` | 1.2 | heros, entradas de seção, momentos de respiro |
| `epic` | 1.8 | transições-âncora, "momentos de câmera" |

**Eases canônicos** (a "assinatura" do movimento):

| Token | Valor | Sensação |
|---|---|---|
| `out` | `power3.out` | **o padrão.** Entrada decidida que desacelera com graça |
| `inOut` | `power3.inOut` | movimentos que vão e voltam (pin, câmera) |
| `expo` | `expo.out` | reveals dramáticos, alto contraste de velocidade |
| `soft` | `power2.out` | micro-interações sutis |

> **Regra de refino (Fase 5):** qualquer transição `< 0.6s` é estendida. Qualquer `ease` que **não** seja `power` ou `expo` (ex.: `linear`, `back`, `bounce`, `elastic`) é substituído — eles quebram a sobriedade cinematográfica. `stagger` entre elementos em sequência: **0.15–0.2s**.

---

## Workflow — as 5 Fases

Execute na ordem. Cada fase tem um arquivo de referência com receitas completas e prontas para colar. **Leia o reference da fase antes de gerar código dela.**

### Fase 1 — A Bíblia do Projeto (nunca deixe a IA adivinhar)
Antes de qualquer componente, estabeleça as regras. Crie/atualize o `CLAUDE.md` na raiz do projeto usando o template em **`assets/CLAUDE.md`**, e faça o setup do stack seguindo **`references/01-setup.md`**.

- Instalar: `gsap @gsap/react lenis` (+ Next/Tailwind se projeto novo).
- Fixar a Regra de Ouro e o Sistema de Movimento no `CLAUDE.md`.
- Copiar `assets/lib/lenis-provider.tsx` e `assets/lib/motion.ts` para o projeto.
- **Não gerar componentes ainda.** Primeiro a fundação.

### Fase 2 — O Hero Cinematográfico
A primeira impressão define o tom: tensão e fluidez antes da primeira interação. Receita completa em **`references/02-hero.md`**.

- Fullscreen, vídeo em loop no background (com fallback de imagem e overlay).
- Texto surge com reveal suave (mask + `y`/`opacity`, `slow` + `expo.out`), em sequência com `stagger`.
- Indicador de scroll que **desaparece** quando o usuário começa a descer.

### Fase 3 — Scroll com "Olhar de Câmera"
Onde a mágica acontece: o scroll vira movimento de câmera. Receitas (pin, sequência, parallax, scrub) em **`references/03-scroll-camera.md`**.

- Seções com **pin scroll** via ScrollTrigger.
- Elementos entram em **sequência** (`stagger` 0.15–0.2s) com `power3.out`.
- Scroll **controlado** (`scrub`), não animação solta — o tempo segue o dedo do usuário.

### Fase 4 — Domando o Caos Mobile
Animações complexas quebram no mobile por design, não por acaso. Estratégia em **`references/04-mobile-a11y.md`**.

- Separar desktop≠mobile com **`gsap.matchMedia()`** — não `if` espalhado pelo código.
- Respeitar **`prefers-reduced-motion`** (acessibilidade + anti-enjoo + risco legal).
- Performance: animar só `transform`/`opacity`, evitar `pin` pesado no toque, conferir conflito Lenis↔ScrollTrigger.
- **Não alterar a estética do desktop** ao corrigir o mobile.

### Fase 5 — Refinamento Artístico
O polimento final que separa "animado" de "cinematográfico". Checklist em **`references/05-refinamento.md`**.

- Toda transição `< 0.6s` → estendida.
- Todo `ease` fora de `power`/`expo` → substituído.
- Conferir consistência: tudo puxa de `motion.ts`? Os tempos respiram juntos?

---

## Checklist de Qualidade (rode antes de entregar)

- [ ] Lenis e ScrollTrigger compartilham `gsap.ticker` (sem RAF duplo).
- [ ] Animações React usam `useGSAP` (de `@gsap/react`) com `scope` → cleanup automático, sem vazamento entre rotas.
- [ ] Componentes com GSAP são `"use client"` e registram o plugin (`gsap.registerPlugin(ScrollTrigger, useGSAP)`).
- [ ] Todo timing/ease vem de `motion.ts` — zero números mágicos espalhados.
- [ ] `gsap.matchMedia()` cobre desktop e mobile; `prefers-reduced-motion` desliga/encurta o movimento.
- [ ] Só `transform` e `opacity` animados (sem animar `width`, `top`, `margin` → reflow).
- [ ] `ScrollTrigger.refresh()` chamado após carregar fontes/imagens que mudam a altura da página.
- [ ] Nada abaixo de 0.6s; nenhum `linear/back/bounce/elastic`.

---

## Portabilidade (fora do Next)

O Sistema de Movimento e a Regra de Ouro valem em qualquer ambiente. Para HTML/CSS puro, WordPress/Divi ou LearnWorlds: use GSAP + ScrollTrigger + Lenis via CDN, mantenha os mesmos tokens de duration/ease, e **prefixe** classes/seletores para não vazar estilo na plataforma. Notas específicas no fim de `references/01-setup.md`.

---

## Mapa dos arquivos da skill

- `assets/CLAUDE.md` — template da bíblia do projeto (copiar para a raiz e ajustar).
- `assets/lib/lenis-provider.tsx` — provider React/Next com a integração Lenis↔GSAP canônica.
- `assets/lib/motion.ts` — tokens de movimento (durations, eases, helpers de reveal).
- `references/01-setup.md` — stack, instalação, integração, SSR/Next, portabilidade.
- `references/02-hero.md` — receita do hero cinematográfico completa.
- `references/03-scroll-camera.md` — pin, stagger, parallax, scrub, horizontal scroll.
- `references/04-mobile-a11y.md` — matchMedia, reduced-motion, performance, debug mobile.
- `references/05-refinamento.md` — sistema de movimento detalhado e checklist de polimento.
