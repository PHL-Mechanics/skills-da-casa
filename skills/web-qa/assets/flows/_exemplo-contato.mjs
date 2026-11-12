// Fluxo de exemplo: formulário de contato.
// O "_" no começo do nome desativa o fluxo. Renomeie para contato.mjs para ativar.
// Fluxos são descobertos automaticamente em qa/flows/*.mjs; não há lista para registrar.
//
// Regras:
// - Contra alvo remoto, NUNCA envie dado real: intercepte o POST (page.route) como abaixo.
// - Credenciais e dados de teste vêm de ctx.env (arquivo .env.qa, fora do git).
// - Use seletores estáveis: role/label/texto visível ou data-testid. Evite classes do Tailwind.

export default {
  name: 'Formulário de contato envia e mostra confirmação',
  // targets: ['local', 'remote'], // opcional: limita onde o fluxo roda

  async run({ page, goto, step, assert, target, env }) {
    await step('abrir página de contato', async () => {
      await goto('/contato');
      await assert.visible(page.getByRole('heading', { level: 1 }), 'A página de contato não tem H1 visível.');
    });

    if (target === 'remote') {
      // Em produção o fluxo valida a interface sem disparar e-mail/CRM de verdade.
      await page.route('**/api/contato**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
      );
    }

    await step('validar campos obrigatórios', async () => {
      await page.getByRole('button', { name: /enviar/i }).click();
      await assert.visible(page.locator('[aria-invalid="true"], :invalid').first(), 'Enviar vazio não mostrou nenhum campo inválido.');
    });

    await step('preencher e enviar', async () => {
      await page.getByLabel(/nome/i).fill('Teste Automatizado QA');
      await page.getByLabel(/e-?mail/i).fill(env.QA_CONTACT_EMAIL || 'qa@example.com');
      await page.getByLabel(/mensagem/i).fill('Mensagem enviada pelo web-qa. Pode ignorar.');
      await page.getByRole('button', { name: /enviar/i }).click();
    });

    await step('confirmar sucesso', async () => {
      await assert.visible(page.getByText(/(mensagem enviada|obrigad[oa]|recebemos)/i), 'Nenhuma confirmação de envio apareceu.');
    });
  },
};
