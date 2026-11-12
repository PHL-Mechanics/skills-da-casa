# 05 — Refinamento Artístico

O passo que separa "tem animação" de "é cinematográfico". Sites cinematográficos não são rápidos — são **lentos com intenção**. Esta fase é uma auditoria final de movimento: cada transição é interrogada por tempo, ease e propósito.

## A auditoria (passe item por item)

### 1. Duração — nada abaixo de 0.6s
Varra o projeto. Toda transição/animação `< 0.6s` é estendida.

- Reveals de texto/imagem → `DURATION.base` (0.9s).
- Heros, entradas de seção → `DURATION.slow` (1.2s).
- Transições-âncora / momentos de câmera → `DURATION.epic` (1.8s).
- Micro-interações (hover, botão) → `DURATION.fast` (0.6s) — **o piso, nunca menos.**

### 2. Easing — só `power` e `expo`
Substitua **qualquer** ease que não seja da família `power` ou `expo`:

| Trocar isto | Por isto | Porquê |
|---|---|---|
| `linear` (exceto scrub/parallax) | `power3.out` | linear é robótico |
| `back` / `back.out` | `power3.out` | o overshoot quebra a sobriedade |
| `bounce` | `power3.out` | infantiliza |
| `elastic` | `expo.out` | chamativo demais |
| `power1` / `sine` | `power3.out` | falta contraste de velocidade |

> **Exceção única:** animações atreladas a `scrub` (parallax, faixa horizontal) usam `ease: 'none'` — o ease real vem da inércia do Lenis. Ease duplo aqui = movimento elástico enjoativo.

### 3. Consistência — tudo vem de `motion.ts`
- Zero números mágicos de duração/ease espalhados. Se achar `duration: 0.4` ou `ease: 'sine.in'` cravado num componente → mover para token.
- Os tempos "respiram juntos"? Seções diferentes devem usar a mesma paleta de durations, senão o ritmo fica desconexo.

### 4. Ritmo e respiro
- **Stagger** entre elementos em sequência: 0.15–0.2s. Menos que isso = entram quase juntos (perde o "olhar de câmera"); mais = arrasta.
- **Sobreposição** em timelines: use `'<'`, `'>'`, `'+=0.2'` para encadear com elegância em vez de animações isoladas e secas.
- **Vazio é parte do design.** Deixe momentos sem movimento entre cenas — o contraste valoriza o que se move.

### 5. Direção e peso
- Movimento tem direção e física. Entradas vêm de uma direção coerente (texto sobe, mídia faz zoom-out). Não jogue elementos de todos os lados.
- `expo.out` para drama (alto contraste de velocidade), `power3.out` para naturalidade. Escolha por intenção, não por hábito.

## Checklist final (cole e marque)

```
MOVIMENTO
[ ] Nenhuma transição abaixo de 0.6s
[ ] Nenhum ease fora de power/expo (exceto 'none' em scrub/parallax)
[ ] Stagger entre 0.15s e 0.2s em sequências
[ ] Timelines usam sobreposição ('<','+=') em vez de animações soltas
[ ] Há respiro (vazios intencionais) entre cenas

ARQUITETURA
[ ] Todo timing/ease vem de motion.ts (zero número mágico)
[ ] Lenis e ScrollTrigger compartilham gsap.ticker (sem RAF duplo)
[ ] Animações React via useGSAP com scope (cleanup automático)
[ ] Só transform/opacity animados (sem reflow)
[ ] ScrollTrigger.refresh() após fontes/imagens/vídeo

RESPONSIVO & A11Y
[ ] gsap.matchMedia() cobre desktop e mobile
[ ] prefers-reduced-motion desliga movimento e smooth scroll
[ ] Mobile sem pins/scrubs pesados; estética do desktop intacta
[ ] markers removidos; nenhum console.log de debug

ENTREGA
[ ] Vídeos com poster/fallback; autoplay muted playsInline
[ ] Sem warnings de hydration no Next
[ ] Testado em scroll rápido (toque) e em resize/rotação
```

## Prompt de refino (para disparar a fase)

> *"Revise todas as animações do projeto. Qualquer transição abaixo de 0.6s precisa ser estendida. Substitua qualquer ease que não seja power3 ou expo (exceto 'none' em scrub/parallax). Garanta que todo timing venha de `motion.ts`. O foco é elegância e fluidez, não velocidade."*
