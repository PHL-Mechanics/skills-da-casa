# Skills da casa

Skills do Claude Code usadas nos projetos da casa. O manual do treinamento pede para instalar este repositório no capítulo "Skills da casa".

| Skill | Para quê | Quando chamar |
| --- | --- | --- |
| `commit-push` | confere o que vai subir, barra `.env` e arquivos grandes, faz o commit em português e o push | "pode commitar e subir" |
| `web-qa` | testa o site em camadas: build, fluxos, celular e computador, Lighthouse, acessibilidade, SEO e LGPD | antes de todo PR |
| `cinematic-web` | movimento no scroll com GSAP e Lenis | sites vitrine, com o OK do mentor |

## Instalar

O repositório é privado. Para instalar, você precisa do Node.js 22.20 ou mais novo e do GitHub CLI com login feito (`gh auth status` mostra se está tudo certo).

```bash
npx skills add PHL-Mechanics/skills-da-casa --skill '*' -g -a claude-code -y
```

Depois de instalar, comece uma conversa nova no Claude Code para ele enxergar as skills.

Na primeira vez que a `web-qa` roda, o Claude instala as dependências dela (Playwright, Lighthouse e axe) e baixa um Chromium. Isso leva alguns minutos e só acontece uma vez.

## Atualizar

```bash
npx skills update -g
```

Para ver se há atualização sem instalar nada, use `npx skills check`.

## Para o mentor: mudar ou criar uma skill

1. Edite a skill em `skills/<nome>/`. Uma skill nova precisa de uma pasta própria com um `SKILL.md` que tenha `name` e `description` no cabeçalho.
2. Confira se o instalador encontra as skills: `npx skills add ./ --list`, rodado na pasta do repositório.
3. Faça o commit e o push. Os alunos recebem a mudança quando rodarem `npx skills update -g`.

Não suba `node_modules`. A `web-qa` instala o que precisa na primeira vez que roda, e o `.gitignore` já bloqueia essa pasta.
