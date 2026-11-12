# Revisão visual por screenshots

Os checks automáticos pegam o que é mensurável: overflow, imagem quebrada, texto cortado ou invisível, alvo de toque pequeno e sobra de dev. Esta revisão pega o que só aparece olhando: hierarquia, alinhamento, sobreposição, ritmo e acabamento.

## Sumário
1. Como revisar
2. Checklist
3. Severidade
4. Falsos positivos conhecidos
5. Formato do visual-review.json

## 1. Como revisar

1. Leia `visual/manifest.json` da execução. Cada item tem `route`, `breakpoint`, `files` (fatias em ordem, de cima para baixo) e `truncated` (a página continua além das fatias).
2. Abra **todas** as fatias de cada rota em cada breakpoint com a ferramenta de leitura de arquivo. Compare a mesma rota entre larguras: muito bug de layout só aparece na comparação.
3. Cruze com os achados automáticos da camada visual no `summary.md`. Confirme ou descarte cada um olhando a imagem.
4. Declare em `reviewed` somente o que você abriu de fato. O `finalize` recusa captura sem revisão declarada, e declarar sem olhar anula o propósito da verificação.
5. Se a revisão ficar pesada (muitas rotas), rode de novo com `--routes` focando nas rotas afetadas pela mudança em vez de revisar por amostragem.

## 2. Checklist

### Layout e alinhamento
- Grid quebrado: coluna caindo para baixo da outra fora de hora, cards de alturas desencontradas sem intenção.
- Elementos sobrepostos: texto sobre imagem sem contraste, header fixo cobrindo título, botão atrás de outro elemento.
- Conteúdo colado na borda da tela no mobile (sem padding lateral).
- Espaçamento vertical inconsistente entre seções equivalentes.
- Alinhamentos que quase batem (2 a 8px de diferença) entre blocos que deveriam alinhar.
- Seção vazia ou buraco grande no meio da página (frequentemente é reveal de animação que não disparou).

### Tipografia
- Fonte de fallback (Times, Arial genérica) no lugar da webfont: falha de carregamento da fonte.
- Hierarquia confusa: H2 maior que H1, corpo e título com peso parecido.
- Linhas muito longas no desktop (acima de ~80 caracteres) ou títulos quebrando com uma palavra sozinha na última linha.
- Texto estourando botão, badge ou card.

### Imagens e mídia
- Imagem distorcida (proporção esticada), recorte cortando rosto ou produto, baixa resolução visível.
- Placeholder, ícone de imagem quebrada ou vídeo de fundo que virou retângulo preto.

### Conteúdo
- Texto de template, copy em inglês esquecido num site em PT-BR, "Lorem", datas e preços incoerentes.
- Rodapé com ano antigo, links de redes apontando para o genérico.

### Mobile
- Menu inacessível ou aberto por padrão, CTA principal fora da primeira dobra sem motivo.
- Header ocupando mais de ~20% da altura da tela.
- Tabela ou bloco de código forçando rolagem horizontal da página inteira.

### Acabamento
- Cara de template genérico: tudo em cards idênticos com a mesma sombra, gradiente decorativo sem função.
- Estados visíveis quebrados: botão desabilitado parecendo ativo, foco invisível.
- Banner de cookies cobrindo conteúdo relevante no mobile.

## 3. Severidade

| Severidade | Critério | Exemplo |
|---|---|---|
| `alto` | Impede uso, esconde conteúdo ou quebra a confiança na marca | CTA coberto, texto ilegível, seção inteira vazia, layout quebrado no mobile |
| `medio` | Visivelmente errado, mas a página continua usável | Desalinhamento claro, fonte de fallback, imagem distorcida |
| `baixo` | Acabamento | Espaçamento irregular, título com palavra órfã |

Na dúvida entre dois níveis, escolha o menor e explique no `detail`. Severidade inflada faz o relatório perder credibilidade.

## 4. Falsos positivos conhecidos

- **ScrollTrigger com pin**: seções fixadas geram capturas com trechos repetidos ou alongados. Não é bug se no navegador a animação funciona.
- **Carrossel e abas**: slides inativos com `opacity: 0` disparam "Texto invisível". Descarte com motivo.
- **`reducedMotion: reduce`**: o runner captura com movimento reduzido por padrão. Sites que respeitam a preferência mostram o estado final. Se o site esconde conteúdo nesse modo, **isso é bug real** (acessibilidade).
- **Fixed/sticky**: header fixo aparece só na primeira fatia.
- **Lazy loading agressivo**: imagem ainda carregando na captura. Confirme pelo achado automático de imagem quebrada antes de reportar.

## 5. Formato do visual-review.json

Salve na pasta da execução (a mesma do `report.json`) e rode `node <SKILL_DIR>/scripts/run.mjs finalize "<runDir>"`.

```json
{
  "reviewed": [
    { "route": "/", "breakpoints": [375, 768, 1440] },
    { "route": "/contato", "breakpoints": [375, 768, 1440] }
  ],
  "findings": [
    {
      "severity": "alto",
      "route": "/",
      "breakpoint": 375,
      "title": "Botão principal do hero coberto pelo banner de cookies",
      "detail": "Na primeira dobra o banner ocupa o terço inferior e esconde o CTA 'Agende sua consulta'.",
      "fix": "Banner compacto no mobile (uma linha + botão) ou empurrar o CTA para cima.",
      "evidence": ["visual/home__375__1.png"]
    }
  ],
  "dismissed": [
    { "id": "F9a7c8e1b", "reason": "Slides inativos do carrossel de depoimentos; no navegador alternam normalmente." }
  ],
  "notes": "Opcional: observações gerais da revisão."
}
```

Regras aplicadas pelo `finalize`:
- `severity`: `alto`, `medio` ou `baixo`. `title` com pelo menos 5 caracteres. `route` começando com `/`.
- `dismissed` só aceita IDs das camadas `visual` e `a11y-seo`, sempre com motivo. Achado funcional, de LGPD ou performance não se descarta na revisão: ou se corrige, ou vira exceção com motivo na config.
- `finalize` é idempotente: rodar de novo recalcula a partir dos achados automáticos originais mais a revisão atual.
- `report.json` editado à mão invalida a execução. Rode a verificação de novo.
