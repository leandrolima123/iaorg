# Segurança

## Como reportar uma falha

**Não abra issue pública** para falhas de segurança.

Use o reporte privado do GitHub: na aba **Security** do repositório, clique em **Report a vulnerability**. Inclua:

- o que a falha permite fazer e qual parte do sistema ela afeta;
- os passos para reproduzir (de preferência numa instalação local);
- a versão ou o commit que você testou.

Vamos confirmar o recebimento em até 3 dias úteis e combinar com você o prazo da correção e da divulgação. Quem reportar com responsabilidade recebe crédito na nota da correção, se quiser.

## Versões cobertas

Só a branch `main` recebe correções.

## O que já faz parte do desenho

Antes de reportar, vale saber como o IAORG se protege. Assim fica fácil ver o que é falha e o que é configuração:

- **Login:** Keycloak com OIDC + PKCE no padrão BFF. O navegador só recebe um cookie `HttpOnly` assinado.
- **Segredos:** as chaves das empresas (Claude, GitHub, integrações) são cifradas com AES-256-GCM usando `APP_SECRET` e nunca entram nas conversas dos agentes.
- **Isolamento:** cada empresa tem dados, arquivos e agentes próprios, e toda rota confere a empresa pela sessão ou pelo token.
- **Tokens de MCP:** só o hash fica guardado. O token nunca passa do papel de quem o criou e tem limite de 120 chamadas por minuto.
- **Oficina:** cada tarefa roda num container efêmero sem privilégios, sem acesso ao app nem ao Keycloak. Push na branch principal e push forçado são bloqueados.

## Ao rodar em produção

- Gere `APP_SECRET` e `RUNNER_TOKEN` longos e aleatórios (`openssl rand -hex 32`).
- Troque todas as senhas padrão do `.env.example`, inclusive a do console do Keycloak.
- Publique só o app e o Keycloak atrás de HTTPS. O runner tem acesso ao `docker.sock` e não deve ficar exposto.
- Nunca faça commit do `.env` nem da pasta `data/`.
