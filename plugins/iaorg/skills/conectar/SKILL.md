---
name: conectar
description: Configura e diagnostica a conexão do Claude Code com o IAORG (servidor MCP do plugin iaorg). Use quando a pessoa quiser conectar o IAORG, quando as ferramentas do IAORG não aparecerem ou quando derem erro de autenticação ou de conexão.
---

# Conectar o Claude Code ao IAORG

O plugin conecta no endereço `${user_config.iaorg_url}/mcp`. Ele envia o cabeçalho `Authorization: Bearer <token>`, com o token guardado no cofre de credenciais do sistema.

Nunca peça para a pessoa colar o token na conversa e nunca o escreva em arquivos do projeto. O token só entra pela configuração do plugin.

## 1. Ter um IAORG rodando

Se a pessoa ainda não tem o IAORG, ele sobe com Docker:

```bash
git clone https://github.com/leandrolima123/iaorg.git && cd iaorg
cp .env.example .env    # preencha APP_SECRET e RUNNER_TOKEN com: openssl rand -hex 32
docker compose up -d --build
```

O app fica em `http://localhost:3000`. A pessoa cria a conta, monta a empresa no onboarding e só então segue.

## 2. Criar o token

No IAORG, em **Ajustes → Acesso por IA (MCP)**, a pessoa cria um token com um nome (por exemplo, "Claude Code do notebook") e um nível:
- **Leitura:** só consulta.
- **Operação:** cria tarefas e manda mensagens.
- **Administração:** contrata, edita fichas e aprova. Só para administradores da empresa.

O token começa com `iaorg_` e aparece uma única vez.

## 3. Configurar o plugin

A pessoa roda `/plugin configure iaorg@iaorg` e informa:
- **Endereço do IAORG**, sem barra no fim, por exemplo `http://localhost:3000`;
- **o token**.

Depois roda `/reload-plugins`, ou abre uma nova sessão.

## 4. Diagnosticar

Faça nesta ordem e pare no primeiro problema:

1. **O servidor aparece?** Peça à pessoa para rodar `/mcp` e procurar `plugin:iaorg:iaorg`. Se não aparecer, o plugin não está habilitado: `/plugin` → aba **Installed**.
2. **O IAORG responde?** Rode uma requisição sem o token. A resposta esperada é **401** com a mensagem "Envie o cabeçalho Authorization", o que prova que o endereço está certo:

   ```bash
   curl -s -X POST <endereço>/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

   - Se a conexão for recusada, o IAORG não está rodando ou o endereço está errado. Confira com `docker compose ps`.
   - Se der 404, o endereço aponta para outro serviço.
3. **O token vale?** Se o servidor aparece em `/mcp` com erro de autenticação, o token foi revogado, foi copiado pela metade ou é de outra instalação. A pessoa cria um novo token e roda `/plugin configure iaorg@iaorg` de novo.
4. **Faltam ferramentas?** O nível do token decide quais aparecem. Para contratar ou aprovar, o token precisa ser de administração e a pessoa precisa ser administradora da empresa.

Quando funcionar, chame a ferramenta `empresa_resumo` e mostre o nome da empresa e a equipe para confirmar.

## Sem o plugin

Também dá para conectar direto pela linha de comando:

```bash
claude mcp add --transport http iaorg http://localhost:3000/mcp --header "Authorization: Bearer iaorg_..."
```

Nesse caso o token fica na configuração do Claude Code em texto. O plugin é melhor porque o guarda no cofre do sistema.
