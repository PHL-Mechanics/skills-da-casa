# Configuração e interpretação

## Sumário
1. qa.config.json completo
2. Exceções
3. Budgets de performance
4. O que cada camada verifica e como classifica
5. Variáveis de ambiente
6. Saída, códigos e arquivos
7. Rodando fora do Claude Code (CI, Coolify)

## 1. qa.config.json completo

Tudo é opcional. Sem arquivo, o runner usa os padrões abaixo (com `--url`). Com `init`, o arquivo nasce com o que foi detectado no projeto.

```json
{
  "project": "nome-do-projeto",
  "targets": {
    "local": {
      "baseUrl": "http://localhost:3000",
      "server": { "command": "npm run start" }
    },
    "remote": { "baseUrl": "https://www.exemplo.com.br" }
  },
  "build": { "commands": null },
  "routes": { "discover": true, "include": ["/blog/um-post-real"], "exclude": ["/admin*"], "max": 25 },
  "breakpoints": [375, 768, 1440],
  "visual": { "maxSlicesPerPage": 4, "sliceHeightFactor": 1.5, "reducedMotion": true, "mask": ["[data-qa-mask]"] },
  "functional": { "checkLinks": true, "maxLinks": 150 },
  "performance": { "routes": ["/"], "runs": 3, "formFactor": "mobile" },
  "budgets": { "lcpMs": 2500, "cls": 0.1, "tbtMs": 200, "fcpMs": 1800, "totalKb": 1600, "jsKb": 450 },
  "a11y": { "tags": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  "seo": { "expectIndexable": "auto" },
  "lgpd": { "allowlist": [] },
  "exceptions": [],
  "timeouts": { "navigationMs": 45000, "flowMs": 90000, "buildMs": 900000, "serverReadyMs": 90000 }
}
```

| Chave | Detalhe |
|---|---|
| `targets.local.server.command` | Se o alvo local não responder, o runner sobe esse comando e derruba no fim. `null` = você sobe o servidor. `next start` exige build existente |
| `build.commands` | `null` auto-detecta pelo package.json (typecheck/tsc, lint, build). Aceita lista ou `{"quick": [...], "full": [...]}` |
| `routes.discover` | Local: lê `app/` e `pages/` do Next. Sem isso: `sitemap.xml`. Sem sitemap: links da home |
| `routes.include` | Obrigatório para rotas dinâmicas (`[slug]`): informe exemplos reais |
| `routes.exclude` | Padrões com `*` ou `re:<regex>`. A home nunca é excluída |
| `visual.reducedMotion` | Captura com `prefers-reduced-motion: reduce` para estados finais estáveis |
| `visual.mask` | Seletores cobertos por tarja nos screenshots. Use em áreas que exibem dado pessoal |
| `performance.formFactor` | `mobile` (padrão, com throttling) ou `desktop` |
| `seo.expectIndexable` | `auto` exige indexação só em alvo remoto com cara de produção |

## 2. Exceções

Exceção é uma decisão de arquitetura: esconde um achado de propósito. Por isso é estreita, explícita e aparece no relatório.

```json
{
  "exceptions": [
    {
      "layer": "functional",
      "match": "widget.hotjar.com",
      "routes": ["/"],
      "reason": "Script do Hotjar falha em rede bloqueada; fora do nosso código",
      "expires": "2026-12-31"
    }
  ]
}
```

| Campo | Regra mecânica |
|---|---|
| `layer` | Uma camada. `"*"` só com `routes` definido |
| `match` | Texto (mín. 3 caracteres) ou `re:<regex>` contra título e detalhe do achado. Regex que casa com tudo é recusada |
| `reason` | Obrigatório, mín. 10 caracteres. Sem motivo, o runner não roda |
| `routes` | Opcional. Suprime só se todas as rotas do achado estiverem na lista |
| `expires` | Opcional, AAAA-MM-DD. Vencida, para de suprimir e vira achado Médio |

O relatório lista todas as exceções, quantos achados cada uma suprimiu e as que não suprimiram nada (candidatas a remoção).

`lgpd.allowlist` segue a mesma lógica para valores públicos que aparecem em URL de propósito (ex.: e-mail institucional num link de rastreio de campanha): `{"match": "contato@empresa.com.br", "reason": "e-mail institucional publicado no site"}`.

## 3. Budgets de performance

Padrões alinhados aos limites "bons" do Core Web Vitals no perfil mobile. Estourar até 1,5× o budget é Médio; acima disso, Alto (CLS: acima de 2,5×).

Afrouxar qualquer budget acima do padrão exige `budgets.reason`:

```json
{ "budgets": { "lcpMs": 3200, "reason": "Hero com vídeo institucional exigido pela diretoria; revisar após compressão" } }
```

Leitura correta:
- **Performance é pulada em servidor de dev** (`next dev`, Vite dev). Números de dev enganam nos dois sentidos. Use build de produção local ou `--target remote`.
- **Mediana de 3 execuções.** A nota geral do Lighthouse varia de 5 a 10 pontos entre execuções e não entra no veredito. Os budgets olham as métricas.
- Local não tem latência de CDN e rede real. Número de produção vem do alvo remoto.

## 4. O que cada camada verifica e como classifica

| Camada | Alto | Médio | Baixo |
|---|---|---|---|
| Build | Tipos, lint ou build falhando | | Avisos de lint |
| Funcional | Rota com erro ou que não carrega, exceção JS não tratada, erro de hidratação, request do próprio site falhando, asset crítico 4xx/5xx, link interno quebrado, fluxo falhando | Erro de console, imagem/fonte do site 4xx, link sem resposta, fluxo com exceções | Recurso de terceiro falhando |
| Visual | Rolagem horizontal, imagem quebrada, conteúdo de dev na tela | Texto invisível após rolar, texto cortado, 5+ alvos de toque pequenos | Poucos alvos pequenos, texto < 12px no mobile |
| A11y e SEO | axe critical/serious, sem `<title>`, sem viewport, produção com noindex | axe moderate, sem description, sem H1, sem lang, title duplicado | axe minor, title longo, múltiplos H1, OG incompleto, sem canonical |
| LGPD | CPF (com dígito verificador), e-mail, telefone, documento ou dado de saúde em URL | Token/segredo em URL, dado pessoal em console, storage ou cookie | |
| Performance | Métrica > 1,5× budget | Métrica acima do budget | |

A camada LGPD não varre o HTML das páginas nem corpos de POST: contato institucional exibido no site não é vazamento, e formulário enviando dado via POST é o caminho correto. Todo valor sensível sai mascarado no relatório.

## 5. Variáveis de ambiente

| Variável | Uso |
|---|---|
| `QA_CHROME_PATH` | Caminho de um Chrome/Chromium já instalado (quando o download do Playwright é bloqueado) |
| `QA_CHROME_ARGS` | Flags extras do Chromium, separadas por espaço |

Credenciais de fluxos ficam no `.env.qa` do projeto, lidas em `ctx.env`.

## 6. Saída, códigos e arquivos

Cada execução cria `<projeto>/.qa-runs/<AAAAMMDD-HHMMSS>-<alvo>-<modo>/` e atualiza `.qa-runs/latest.txt`.

| Arquivo | Escritor | Conteúdo |
|---|---|---|
| `report.json` | Runner (único) | Resultado estruturado. Protegido por `.integrity` |
| `report.html` | Runner | Relatório para humanos |
| `summary.md` | Runner | Resumo para o agente ler e reportar |
| `visual/` | Runner | Fatias PNG e `manifest.json` |
| `visual-review.json` | Agente | Revisão dos screenshots |
| `lighthouse/` | Runner | JSON bruto do Lighthouse por rota |
| `logs/`, `run.log` | Runner | Saída de build e da execução |

| Código | Significado |
|---|---|
| 0 | Nenhum achado Alto |
| 1 | Pelo menos um achado Alto |
| 2 | Erro de uso, config inválida, relatório adulterado ou falha inesperada |

## 7. Rodando fora do Claude Code (CI, Coolify)

O runner é um script Node comum. Em GitHub Actions ou num passo de pré-deploy:

```bash
cd ~/.claude/skills/web-qa/scripts && npm ci && npx playwright install --with-deps chromium
node ~/.claude/skills/web-qa/scripts/run.mjs --project "$GITHUB_WORKSPACE" --mode completo --target remote --url "$PREVIEW_URL" --only functional,a11y-seo,lgpd,performance
```

O código de saída 1 bloqueia o pipeline quando houver achado Alto. A revisão visual continua sendo trabalho do agente ou de uma pessoa.
