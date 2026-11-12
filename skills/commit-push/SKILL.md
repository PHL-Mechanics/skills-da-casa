---
name: commit-push
description: Revisa o que mudou no repositório, faz o commit com mensagem em português e dá push na branch atual. Use quando a pessoa disser "pode dar o push", "faz commit push", "commita", "commitar e subir", "sobe isso", "dá o push".
---

# Commit e push

Fecha o trabalho atual: um commit bem descrito e o push, sem a pessoa ter que pedir passo a passo.

## Passos
1. Rode `git status` e `git diff` (e `git diff --staged`) para ver o que mudou.
2. Se não houver nada para commitar, mas houver commits locais à frente do remoto, pule direto para o push.
3. Confira se não há arquivo que não deve subir: `.env`, chaves, credenciais, `node_modules`, builds, arquivos grandes ou temporários. Se houver, pare e pergunte.
4. Adicione os arquivos pelo nome (`git add <arquivos>`), não `git add -A` às cegas.
5. Escreva a mensagem de commit em português, no estilo dos commits recentes do repositório (`git log --oneline -10`): uma linha curta dizendo o que mudou e por quê, e um corpo curto se a mudança for grande.
6. Faça o commit. Se um hook falhar, corrija o problema e crie um commit novo; não use `--no-verify`.
7. Dê push na branch atual (`git push`; se a branch ainda não existir no remoto, `git push -u origin <branch>`).
8. Responda em uma ou duas linhas: a mensagem do commit, a branch e o resultado do push.

## Regras
- Responda em português do Brasil.
- Nunca use `git push --force`, `git reset --hard` ou reescreva histórico sem a pessoa pedir.
- Se o push for rejeitado porque o remoto andou, faça `git pull --rebase`, resolva e tente de novo; se houver conflito, mostre e pergunte.
- Se estiver na branch principal (main/master) e o repositório usar PR, avise antes de dar push direto.
- Não crie PR, tag ou release a menos que a pessoa peça.

## Pronto quando
- `git status` mostra a árvore limpa e "Your branch is up to date with 'origin/<branch>'".
