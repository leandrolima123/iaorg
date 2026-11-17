# Plugin IAORG para o Claude Code

Conecta o Claude Code ao seu IAORG por MCP e ensina o Claude a operar a empresa: contratar agentes, criar e acompanhar tarefas, ler conversas, revisar aprovações e configurar rotinas.

## Instalar

```bash
claude plugin marketplace add leandrolima123/iaorg
```

Numa sessão do Claude Code, rode `/plugin install iaorg@iaorg` e informe:
- **Endereço do IAORG:** por exemplo, `http://localhost:3000`.
- **Token:** crie em **Ajustes → Acesso por IA (MCP)**. Ele fica guardado no cofre de credenciais do sistema.

## O que vem no plugin

| Componente | O que faz |
|---|---|
| Servidor MCP `iaorg` | As ferramentas do IAORG (`empresa_resumo`, `tarefa_criar`, `agente_contratar`…), limitadas pelo nível do token |
| Skill `iaorg` | Como operar a empresa: por onde começar, receitas e o que pede confirmação |
| Skill `/iaorg:conectar` | Passo a passo para conectar e diagnosticar a conexão |

Detalhes das ferramentas e dos níveis de token no [README do projeto](../../README.md#acesso-por-ia-servidor-mcp).
