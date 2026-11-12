---
name: web-qa
description: Verificação automatizada de sites e apps web (Next.js, React, Vite, Astro, sites estáticos e URLs publicadas na Vercel/Coolify) em camadas, com relatório priorizado por impacto. Cobre build/tipos/lint, rotas e fluxos críticos no navegador (formulário, login, checkout em sandbox), revisão visual por screenshots em mobile/tablet/desktop, performance com Lighthouse, acessibilidade (WCAG), SEO técnico e vazamento de dados pessoais (LGPD). Use SEMPRE que o usuário pedir para verificar, testar, validar, revisar, checar, auditar ou "dar uma olhada" num site, página, app ou deploy; quando perguntar "tá tudo certo?", "quebrou algo?", "funciona no mobile?", "tá rápido?", "posso subir?"; antes de entregar ou fazer deploy; e ao terminar qualquer implementação ou mudança de front-end, mesmo que ninguém tenha dito "QA" ou "teste". Também use para escrever fluxos de teste de jornadas críticas.
---

# web-qa

Verificação em camadas que troca "acho que está funcionando" por evidência. O runner faz a parte mecânica (navegador, Lighthouse, axe, scanner LGPD) e gera um relatório; você revisa os screenshots, reporta e, só quando pedido, corrige.

## Princípios

Estas regras existem porque o jeito mais curto de "passar" numa verificação quase sempre é o errado.

1. **Evidência antes de afirmação.** Nunca diga que algo funciona, está rápido ou está acessível sem uma execução desta skill que mostre isso. Se não rodou, diga que não rodou.
2. **Verificar e corrigir são etapas separadas.** O padrão é só reportar. Correção só acontece quando o usuário pede, um achado por vez, com revalidação.
3. **O relatório tem um único escritor.** `report.json` é escrito só pelo runner e protegido por hash. Você escreve apenas `visual-review.json` e roda `finalize`. Para mudar um resultado automático, corrija a causa e rode de novo.
4. **Exceção é decisão de arquitetura.** Ignorar achado exige entrada em `exceptions` com motivo, e ela aparece no relatório. Afrouxar budget também exige motivo. O runner recusa rodar sem isso.
5. **Trabalho novo entra como arquivo isolado.** Fluxos novos são arquivos em `qa/flows/`, descobertos automaticamente. Não existe lista central para editar.

## Setup (uma vez por máquina)

`<SKILL_DIR>` é a pasta onde este SKILL.md está (normalmente `~/.claude/skills/web-qa`; no Windows, `%USERPROFILE%\.claude\skills\web-qa`).

```bash
cd <SKILL_DIR>/scripts && npm install && npx playwright install chromium
node <SKILL_DIR>/scripts/run.mjs doctor
```

Se `doctor` falhar no Chromium, siga a instrução que ele imprime. As dependências ficam na pasta da skill; o projeto verificado não ganha nenhuma dependência.

## Modos

| Modo | Camadas | Quando | Tempo típico |
|---|---|---|---|
| `rapido` (padrão) | Tipos e lint, funcional, visual em 2 larguras, LGPD | Durante o desenvolvimento, depois de cada mudança relevante | 20 s a 2 min |
| `completo` | Tudo, incluindo build de produção, links, a11y/SEO, Lighthouse e 3 larguras | Antes de entregar, fazer deploy ou abrir PR | 2 a 8 min |

| Alvo | Uso |
|---|---|
| `--target local` (padrão) | Código do repositório rodando na máquina |
| `--target remote` | O que está publicado (`targets.remote.baseUrl`). Build é pulado |
| `--url <url>` | Qualquer URL avulsa, como preview da Vercel. Deduz o alvo |

Foque a execução com `--routes /,/contato` (rotas afetadas pela mudança) e `--only functional,visual`.

## Fluxo de trabalho

### 1. Preparar o projeto

Na raiz do projeto:
- Sem `qa.config.json`: rode `node <SKILL_DIR>/scripts/run.mjs init`. Ele detecta o framework, cria a config, `qa/flows/` com um exemplo desativado, `.env.qa.example` e adiciona `.qa-runs/` e `.env.qa` ao `.gitignore`.
- Mostre ao usuário o que foi criado e preencha `targets.remote.baseUrl` se ele informar o domínio.
- Rotas dinâmicas (`[slug]`) precisam de exemplos reais em `routes.include`. O runner avisa quando pulou alguma.
- Se o usuário descrever jornadas críticas (formulário, login, compra), escreva os fluxos seguindo `references/flows.md`.

### 2. Escolher o escopo e rodar

Escolha pelo pedido:
- "Verifica o que eu mexi" → `rapido` com `--routes` das rotas afetadas. Descubra as rotas pelo `git diff --name-only` (arquivos em `app/<rota>/` mapeiam para `/<rota>`; componentes compartilhados afetam todas).
- "Posso subir?", "revisa tudo", "antes do deploy" → `completo` local.
- "Verifica o site no ar", link de preview → `completo --target remote` ou `--url`.

```bash
node <SKILL_DIR>/scripts/run.mjs --mode rapido
```

Se o servidor local não estiver no ar e não houver `targets.local.server.command`, o runner para e diz como seguir. Não suba servidor de dev e rode `next build` ao mesmo tempo: o runner já pula o build nesse caso e explica.

### 3. Ler o resultado

Leia `summary.md` da pasta da execução (o caminho sai no fim do log e em `.qa-runs/latest.txt`). Ele traz veredito, tabela de camadas, achados por impacto com correção sugerida e notas do que foi pulado.

Código de saída: `0` sem Alto, `1` com Alto, `2` erro de uso/config. Código 2 não é resultado de verificação; resolva a mensagem e rode de novo.

### 4. Revisão visual (obrigatória quando a camada visual rodou)

Siga `references/visual-review.md`:
1. Leia `visual/manifest.json` e abra cada fatia PNG de cada rota e largura.
2. Confirme ou descarte os achados automáticos da camada visual olhando a imagem.
3. Registre problemas que só o olho pega: sobreposição, hierarquia, alinhamento, fonte de fallback, seção vazia, cara de template.
4. Escreva `visual-review.json` na pasta da execução, declarando em `reviewed` apenas o que abriu.

### 5. Finalizar

```bash
node <SKILL_DIR>/scripts/run.mjs finalize "<pasta da execução>"
```

O `finalize` valida a revisão, junta ao relatório e regenera `report.html` e `summary.md`. Se recusar, a mensagem diz exatamente o que falta.

### 6. Reportar no chat

Formato:
- **TL;DR** de uma linha com o veredito.
- Tabela de camadas (status e contagem por impacto).
- Achados **Alto** com rota, largura e correção sugerida. Achados **Médio** resumidos. **Baixo** só como contagem, a menos que peçam.
- **Riscos e incertezas**: camadas puladas ou com erro, rotas não cobertas, falsos positivos possíveis, o que a verificação não testa (ex.: fluxo inexistente para uma jornada crítica).
- Caminho do `report.html`.

Nunca cole no chat valor de dado pessoal. O relatório já mascara; mantenha assim.

### 7. Corrigir (somente quando pedido)

Entra neste passo apenas se o usuário pediu correção ("verifica e corrige", "arruma o que achou").

1. Ordem: build → Alto funcional e LGPD → Alto visual e a11y → Médio.
2. Um achado por vez: a menor mudança que resolve a **causa**. Depois rode só o necessário (`--only` e `--routes`) e confirme que o achado sumiu sem surgir Alto novo.
3. Commits: se o usuário autorizou commits, um por correção no formato `fix(qa): <título do achado> [<ID>]`. Sem autorização, deixe as mudanças no working tree e liste o que mudou.
4. Limite de 3 rodadas. Depois disso, pare e reporte o que resta com o motivo.
5. Feche com a mesma execução que encontrou os problemas (mesmo modo e alvo) e mostre o antes e depois.

**Pare e pergunte** quando a correção exigir: mudar design ou copy aprovados, adicionar dependência, alterar código compartilhado entre muitas rotas, mexer em integração de terceiros ou pagamento, ou quando o "problema" puder ser intencional.

**Nunca**, como forma de passar na verificação: afrouxar budget, criar exceção, usar `@ts-ignore`/`as any`/`eslint-disable`, colocar `overflow-x: hidden` no body, apagar ou enfraquecer fluxo, ou remover o conteúdo que disparou o achado sem resolver a origem. Se uma exceção for de fato o certo, proponha ao usuário com o motivo e deixe a decisão com ele.

## Contextos que mudam o comportamento

- **Produto que o usuário opera mas não é dono** (plataforma de cursos, site de cliente, WordPress de terceiros): rode contra a URL publicada e reporte. Não altere código nem configuração sem pedido explícito de quem decide.
- **Dados de saúde, alunos ou membros**: em alvo remoto, screenshots podem capturar dado pessoal de áreas logadas. Use `visual.mask` nessas áreas, conta de teste dedicada e apague `.qa-runs/` quando não precisar mais. Achado LGPD Alto vem antes de qualquer ajuste visual.
- **Sites com animação pesada (GSAP, ScrollTrigger, Lenis)**: a captura usa movimento reduzido. "Texto invisível" pode ser reveal travado ou site que esconde conteúdo com movimento reduzido; os dois são problemas reais de acessibilidade. Pins geram capturas estranhas, veja os falsos positivos na referência visual.
- **Pagamentos**: fluxo de checkout só local e em sandbox. Nunca contra gateway de produção.

## Referências

- `references/visual-review.md`: checklist visual, severidade, falsos positivos e formato do `visual-review.json`. Leia antes de toda revisão visual.
- `references/flows.md`: contrato dos fluxos, API do `ctx`, exemplos (formulário, login, menu mobile, checkout em sandbox) e regras de segurança. Leia antes de escrever ou corrigir fluxo.
- `references/config.md`: config completa, exceções, budgets, critério de cada camada, variáveis de ambiente, códigos de saída e uso em CI. Leia quando for editar a config ou explicar por que algo foi classificado de certo jeito.
- `assets/flows/_exemplo-contato.mjs`: ponto de partida de fluxo.
