# Fluxos (qa/flows)

Fluxo é uma jornada crítica testada de ponta a ponta no navegador: enviar formulário, logar, abrir menu mobile, chegar ao checkout. Rota que carrega sem erro não prova que a jornada funciona.

## Sumário
1. Contrato
2. API do ctx
3. Regras de segurança
4. Exemplos: formulário, login, menu mobile, checkout em sandbox, busca
5. Seletores estáveis
6. Quando o fluxo quebra

## 1. Contrato

- Um arquivo por jornada em `qa/flows/<nome>.mjs`. **Não existe lista para registrar**: o runner descobre todos os `.mjs`/`.js` da pasta.
- Arquivo começando com `_` fica desativado (útil para rascunho ou fluxo temporariamente fora).
- Export default: uma função `async (ctx) => {}` ou um objeto `{ name, targets?, run }`.
- `targets` (opcional): `['local']`, `['remote']` ou ambos. Sem `targets`, roda nos dois.
- Falhar = lançar erro. Use `ctx.assert.*`, que já gera mensagens claras.
- Cada fluxo roda em contexto de navegador isolado (cookies e storage limpos), viewport 1440×900, timeout total `timeouts.flowMs` (padrão 90 s).
- Os fluxos rodam na camada funcional, depois das rotas. Para rodar só eles: `--only functional --routes /`.

## 2. API do ctx

| Campo | O que é |
|---|---|
| `page`, `context` | Objetos do Playwright. Qualquer API do Playwright funciona |
| `goto(route, opts?)` | Navega para `baseUrl + route` com `waitUntil: 'load'` |
| `step(nome, fn)` | Nomeia um passo. Se falhar, o relatório diz em qual passo |
| `assert.visible(alvo, msg?)` | Espera ficar visível (alvo = seletor ou locator) |
| `assert.hidden(alvo, msg?)` | Espera sumir |
| `assert.text(alvo, esperado, msg?)` | Espera conter texto (string ou RegExp) |
| `assert.url(padrão, msg?)` | Espera a URL conter o padrão (string ou RegExp) |
| `assert.count(alvo, n, msg?)` | Espera exatamente n elementos |
| `assert.ok(condição, msg?)` | Condição síncrona |
| `baseUrl`, `target` | URL base e alvo (`local` ou `remote`) |
| `productionLike` | `true` quando o alvo remoto parece produção (não é localhost, *.vercel.app, preview, staging, homolog) |
| `env` | Variáveis do `.env.qa` do projeto |
| `log(msg)` | Escreve no log da execução |

## 3. Regras de segurança

- **Produção não recebe dado de teste.** Com `target === 'remote'`, intercepte o envio com `page.route` e responda você mesmo, ou limite o fluxo a `targets: ['local']`.
- **Pagamento só em sandbox.** PagBank/PagSeguro e Asaas têm ambiente de sandbox com cartões de teste. Nunca rode checkout contra gateway de produção, mesmo com valor baixo.
- **Credenciais só no `.env.qa`**, que o `init` coloca no `.gitignore`. Nunca no arquivo do fluxo, na config ou em log.
- **Conta de teste dedicada.** Nunca use conta real de paciente, aluno ou membro, nem para leitura: a captura de tela salva o que aparece.
- Ações destrutivas (excluir, cancelar, estornar) só com dados criados pelo próprio fluxo no ambiente local.

## 4. Exemplos

### Formulário de contato
Veja `assets/flows/_exemplo-contato.mjs` (copiado pelo `init` para `qa/flows/`).

### Login com conta de teste

```js
export default {
  name: 'Login com conta de teste leva ao painel',
  async run({ page, goto, step, assert, env }) {
    assert.ok(env.QA_USER_EMAIL && env.QA_USER_PASSWORD, 'Defina QA_USER_EMAIL e QA_USER_PASSWORD no .env.qa');

    await step('abrir login', async () => {
      await goto('/login');
      await assert.visible(page.getByLabel(/e-?mail/i));
    });

    await step('credencial errada mostra erro', async () => {
      await page.getByLabel(/e-?mail/i).fill(env.QA_USER_EMAIL);
      await page.getByLabel(/senha/i).fill('senha-errada-proposital');
      await page.getByRole('button', { name: /entrar/i }).click();
      await assert.visible(page.getByText(/(inválid|incorret)/i), 'Login com senha errada não mostrou mensagem de erro.');
    });

    await step('credencial certa entra', async () => {
      await page.getByLabel(/senha/i).fill(env.QA_USER_PASSWORD);
      await page.getByRole('button', { name: /entrar/i }).click();
      await assert.url(/\/(painel|dashboard|app)/, 'Login válido não levou ao painel.');
    });
  },
};
```

### Menu mobile

```js
export default {
  name: 'Menu mobile abre, navega e fecha',
  async run({ page, goto, step, assert }) {
    await page.setViewportSize({ width: 375, height: 812 });
    await step('abrir home', () => goto('/'));
    await step('abrir menu', async () => {
      await page.getByRole('button', { name: /menu/i }).click();
      await assert.visible(page.getByRole('navigation').getByRole('link').first(), 'O menu não mostrou links.');
    });
    await step('navegar pelo menu', async () => {
      await page.getByRole('navigation').getByRole('link', { name: /contato/i }).click();
      await assert.url('/contato');
    });
  },
};
```

### Checkout em sandbox (somente local)

```js
export default {
  name: 'Checkout em sandbox chega à confirmação',
  targets: ['local'],
  async run({ page, goto, step, assert, env }) {
    assert.ok(env.PAGBANK_ENV === 'sandbox', 'Checkout só roda com PAGBANK_ENV=sandbox no .env.qa.');

    await step('escolher produto', async () => {
      await goto('/cursos/curso-teste');
      await page.getByRole('button', { name: /comprar|matricular/i }).click();
    });

    await step('preencher pagamento com cartão de teste', async () => {
      await page.getByLabel(/nome/i).fill('Teste Sandbox');
      await page.getByLabel(/e-?mail/i).fill(env.QA_BUYER_EMAIL);
      await page.getByLabel(/número do cartão/i).fill(env.SANDBOX_CARD_NUMBER);
      await page.getByLabel(/validade/i).fill(env.SANDBOX_CARD_EXP);
      await page.getByLabel(/cvv|código/i).fill(env.SANDBOX_CARD_CVV);
      await page.getByRole('button', { name: /pagar|finalizar/i }).click();
    });

    await step('confirmar', async () => {
      await assert.visible(page.getByText(/(pagamento aprovado|pedido confirmado|obrigad)/i), 'Checkout sandbox não chegou à confirmação.');
    });
  },
};
```

### Busca retorna resultado

```js
export default async ({ page, goto, step, assert }) => {
  await step('buscar termo conhecido', async () => {
    await goto('/');
    await page.getByRole('searchbox').fill('dipirona');
    await page.keyboard.press('Enter');
  });
  await step('ver resultados', async () => {
    await assert.visible(page.getByRole('listitem').first(), 'Busca por termo conhecido não retornou itens.');
  });
};
```

Busca é o caso clássico de dado pessoal indo parar na URL (`?q=`). A camada LGPD pega se alguém buscar por CPF ou e-mail; o fluxo garante que a busca funciona.

## 5. Seletores estáveis

Em ordem de preferência:
1. `getByRole` com nome acessível (também valida acessibilidade).
2. `getByLabel` para campos de formulário.
3. `getByText` para confirmações e mensagens.
4. `data-testid` quando nada acima for estável.

Evite classes do Tailwind, `nth-child` e textos que mudam com copy de marketing. Seletor frágil gera falha falsa, e falha falsa ensina a ignorar o relatório.

## 6. Quando o fluxo quebra

- **Mudança intencional de comportamento** (botão renomeado, etapa nova): atualize o fluxo **no mesmo commit** da mudança e diga isso no resumo.
- **Mudança não intencional**: é regressão. Corrija o app, não o fluxo.
- Nunca adapte o fluxo só para ele passar. Se não dá para saber se foi intencional, pergunte.
