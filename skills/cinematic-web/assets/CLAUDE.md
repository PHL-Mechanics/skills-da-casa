# CLAUDE.md — Bíblia do Projeto

> Este arquivo dita as regras do jogo ANTES de qualquer linha de código.
> Toda IA que tocar neste projeto lê isto primeiro. Não adivinhe — siga.
> Copie para a raiz do projeto e preencha os `[colchetes]`.

## Projeto

- **Nome:** `[nome do projeto]`
- **Objetivo:** `[ex.: landing page cinematográfica para o produto X]`
- **Tom / referência visual:** `[ex.: filme A24, sóbrio, alto contraste, lento com intenção]`

## Stack (fixo — não troque sem avisar)

- **Framework:** Next.js (App Router) + TypeScript
- **Estilo:** Tailwind CSS
- **Movimento:** GSAP + ScrollTrigger
- **Scroll suave:** Lenis
- **React/GSAP:** `@gsap/react` (`useGSAP`)

```bash
npm i gsap @gsap/react lenis
```

## A REGRA DE OURO (inegociável)

Três bibliotecas, três responsabilidades. Nunca as misture:

| Biblioteca | Faz | Nunca faz |
|---|---|---|
| **Lenis** | scroll suave (a inércia) | animar elementos |
| **GSAP** | mover os elementos | controlar o scroll da página |
| **ScrollTrigger** | orquestrar quando cada animação dispara | rodar seu próprio loop de scroll |

- **Toda animação de scroll usa Lenis** para o smooth scroll; **o movimento dos elementos é GSAP**; **ScrollTrigger orquestra**.
- Lenis e ScrollTrigger **compartilham o `gsap.ticker`** (sem `requestAnimationFrame` duplicado). Use o provider em `lib/lenis-provider.tsx`.
- Animações em React **sempre via `useGSAP`** com `scope` (cleanup automático, sem vazamento entre rotas).
- Componentes com GSAP são `"use client"` e registram o plugin.

## SISTEMA DE MOVIMENTO (tokens — sem números mágicos)

Tudo puxa de `lib/motion.ts`. Proibido espalhar duração/ease cru pelos componentes.

- **Durations:** `fast 0.6` · `base 0.9` · `slow 1.2` · `epic 1.8` (segundos).
- **Nada abaixo de 0.6s.** Cinematográfico é lento com intenção.
- **Eases permitidos:** apenas família `power` (`power2/3.out`, `power3.inOut`) e `expo.out`.
- **Proibidos:** `linear`, `back`, `bounce`, `elastic` — quebram a sobriedade.
- **Stagger entre elementos em sequência:** 0.15–0.2s.

## ACESSIBILIDADE & MOBILE (obrigatório)

- Respeitar `prefers-reduced-motion: reduce` → desligar/encurtar movimento e o smooth scroll.
- Separar desktop ≠ mobile com `gsap.matchMedia()` — não `if` espalhado.
- Animar **somente** `transform` e `opacity` (nunca `width/top/margin` → reflow).
- Chamar `ScrollTrigger.refresh()` após fontes/imagens mudarem a altura da página.

## Ordem de trabalho

1. **Fundação primeiro.** Setup do stack + este CLAUDE.md + `lib/motion.ts` + `lib/lenis-provider.tsx`. **Não gerar componentes ainda.**
2. **Hero** cinematográfico (vídeo de fundo, reveal de texto, indicador de scroll que some).
3. **Seções com olhar de câmera** (pin, sequência, parallax, scrub).
4. **Domar o mobile** sem alterar a estética do desktop.
5. **Refinamento** — passar o checklist de polimento.

## Convenções

- Português em copy e comentários.
- Componentes em `components/`, libs de movimento em `lib/`, seções em `components/sections/`.
- Preferir entregas completas e explicar o raciocínio, não só o código.
