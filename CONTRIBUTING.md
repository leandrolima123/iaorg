# Como contribuir

Obrigado por querer ajudar o IAORG. Este guia mostra como preparar o ambiente, testar e mandar a sua mudança.

## Antes de começar

- **Bug:** abra uma issue com o modelo "Bug", com os passos para reproduzir e o que você esperava.
- **Ideia ou mudança grande:** abra uma issue com o modelo "Ideia" antes de escrever código, para combinarmos o caminho.
- **Falha de segurança:** não abra issue pública. Siga o [SECURITY.md](SECURITY.md).

## Ambiente

Você precisa de Docker (com Compose) e, para rodar fora do Docker, Node 22.

```bash
git clone https://github.com/leandrolima123/iaorg.git && cd iaorg
cp .env.example .env            # preencha APP_SECRET e RUNNER_TOKEN (openssl rand -hex 32)
docker compose up -d --build    # app em http://localhost:3000, Keycloak em http://localhost:8081
```

A oficina dos agentes usa a imagem `workbench` (cerca de 3 GB). Gere uma vez com:

```bash
docker compose --profile build build workbench
```

Sem chave do Claude cadastrada na empresa, os agentes rodam em modo simulado, então dá para mexer na interface sem gastar tokens.

## Testes

Os testes não chamam APIs externas e rodam dentro do container do app:

```bash
docker compose exec -T iaorg node scripts/test-access.mjs
docker compose exec -T iaorg node scripts/test-customer.mjs
docker compose exec -T iaorg node scripts/test-routines.mjs
docker compose exec -T iaorg node scripts/test-whatsapp-ads.mjs
docker compose exec -T iaorg node scripts/test-workbench.mjs
```

O CI do GitHub roda os mesmos testes e confere a sintaxe de todos os arquivos JavaScript.

## Estilo

- **Código:** JavaScript ESM sem etapa de build, no estilo dos arquivos existentes (Express no servidor, módulos simples no navegador).
- **Textos da interface:** em português do Brasil, frases curtas, sem jargão.
- **Comentários:** explique o porquê, não o óbvio.
- **Dependências:** só adicione uma nova se ela resolver algo que não dá para fazer em poucas linhas.

## Pull Requests

1. Crie uma branch a partir da `main` (`git checkout -b minha-mudanca`).
2. Faça commits pequenos, com mensagens que digam o que mudou.
3. Rode os testes e confira a tela que você mexeu.
4. Abra o PR preenchendo o modelo: o que muda, como testar e prints, se mexeu na interface.

Nunca inclua segredos (chaves, tokens, `.env`, a pasta `data/`) nem dados de clientes em commits, issues ou prints.

Ao contribuir, você concorda que a sua contribuição é licenciada sob a [licença MIT](LICENSE) do projeto e segue o nosso [Código de Conduta](CODE_OF_CONDUCT.md).
