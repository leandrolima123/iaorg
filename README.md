# IAORG — Escritório virtual de agentes de IA e pessoas

[![CI](https://github.com/leandrolima123/iaorg/actions/workflows/ci.yml/badge.svg)](https://github.com/leandrolima123/iaorg/actions/workflows/ci.yml)
[![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-f2c200)](LICENSE)
[![Plugin para Claude Code](https://img.shields.io/badge/Claude%20Code-plugin%20MCP-1c1d1c)](#plugin-para-o-claude-code)

**Monte uma empresa em que agentes de IA e pessoas trabalham juntos, num escritório 3D.**

![Capa da demo "Da ordem à entrega"](public/videos/capas/ordem.jpg)

O IAORG é uma plataforma multiempresa (SaaS). Cada cliente monta o seu organograma com **agentes de IA** (CEO, CTO, devs, marketing, atendimento, DevOps…) e **pessoas reais**. Todos aparecem como personagens num **escritório 3D isométrico**.

Você dá uma ordem e a equipe faz o trabalho: os agentes planejam, dividem e delegam tarefas (inclusive para as pessoas) e se reúnem. Eles também atendem clientes por e-mail, chat e WhatsApp, escrevem código e abrem Pull Requests. Você acompanha tudo ao vivo e aprova o que importa.

### Destaques

- **Organograma de verdade:**
  - cada agente tem cargo, chefe, ficha (instruções, procedimentos, exemplos), base de conhecimento e memória própria;
  - pedidos para outra área passam pela aprovação de quem o agente reporta.
- **Oficina:** cada tarefa roda num container isolado com o **Claude Agent SDK**, o motor do Claude Code. O agente:
  - planeja, executa, verifica e entrega;
  - em código, entrega por PR com testes, CI e merge automático só quando tudo passa.
- **Atendimento com controle:**
  - canais: e-mail (Resend, Gmail), chat (Crisp) e WhatsApp (Kapso);
  - envio direto ou com rascunho para aprovação, além de escalonamento para pessoas;
  - os agentes aprendem com as respostas da equipe.
- **Integrações por agente:** GitHub, Google (Gmail, Agenda, Drive, Ads), Railway, Resend, Crisp e Kapso. Cada agente só usa o que foi liberado para ele, com permissões checadas a cada chamada.
- **Rotinas:** tarefas e reuniões recorrentes. Daily, relatórios e monitoramento, com ata e encaminhamentos.
- **Painel (folha de pagamento):**
  - custo real de cada agente e o que ele entregou;
  - custo por tarefa e taxa de acerto do cache.
- **Marca:** identidade visual, tom de voz e modelo dos e-mails (logo, assinatura, rodapé), aplicados automaticamente.
- **Custo sob controle:**
  - modelo por agente (Haiku, Sonnet, Opus, Fable), com cache de prompt de 1 hora e mantenedor no expediente;
  - limites por tarefa e orçamento mensal da empresa.
- **Acesso por IA (MCP):** configure e opere a empresa pelo Claude Code, Claude Desktop ou Cursor.
- **Segurança:**
  - login com Keycloak (OIDC + PKCE, padrão BFF) e multiempresa com isolamento;
  - segredos cifrados (AES-256-GCM);
  - containers de trabalho sem privilégios.

**Stack:** Node 22 (Express, WebSocket), Three.js, Keycloak 26, PostgreSQL, Docker, Claude API e Claude Agent SDK.

## Subir com Docker

```bash
cp .env.example .env      # ajuste segredos (APP_SECRET, RUNNER_TOKEN, senhas)
docker compose --profile build build workbench   # imagem de trabalho dos agentes (~3 GB, uma vez)
docker compose up -d --build
```

| Serviço | Endereço |
|---|---|
| App | http://localhost:3000 |
| Keycloak (login/cadastro; console admin) | http://localhost:8081 — usuário `admin`, senha `KC_ADMIN_PASSWORD` |

Na primeira subida, o Keycloak importa o realm `iaorg` (`keycloak/import/iaorg-realm.json`), que já vem com:
- cadastro aberto;
- Organizations habilitado;
- os clients `iaorg-app` (login) e `iaorg-admin` (API administrativa).

Os segredos dos clients vêm do `.env`. Eles só são aplicados nessa primeira importação; para trocá-los depois, use o console do Keycloak.

## Fluxo do cliente

1. **Criar conta / Entrar.** As telas são do Keycloak. Cada empresa vira uma *Organization* do Keycloak, e quem a cria é o **dono**.
2. **Onboarding** (`/onboarding.html`):
   1. **Empresa:** nome, segmento, site, descrição, missão, **contexto para os agentes** e **logo** (PNG/JPG/WEBP até 5 MB, que aparece no topo, na placa do escritório e nos e-mails).
   2. **Você:** seu personagem (nome, cargo, título e cor). Se você for o CEO, os agentes se reportam a você.
   3. **Claude:** cole a chave da API (testada e guardada **criptografada**), escolha o modelo padrão (Haiku, Sonnet, Opus ou Fable; cada agente pode ter o seu), a profundidade e o orçamento de tokens. Sem chave, os agentes rodam em modo simulado.
   4. **Repositórios:** token fine-grained do GitHub e escolha dos repositórios. Os agentes leem o código e entregam via **Pull Request** em branches `iaorg/...`, nunca direto na branch principal.
   5. **Equipe:** escolha um template de organograma e contrate ou dispense cada agente. Dá para editar nome, chefe e instruções, adicionar cargos do catálogo e **convidar pessoas reais** (e-mail, cargo, chefe e acesso).
   6. **Revisão → Abrir o escritório.**
3. **Convites:** o link `/invite/<token>` vale por 7 dias. A pessoa entra ou se cadastra no Keycloak e aceita, e com isso:
   - vira membro da Organization;
   - ganha um personagem com o cargo definido;
   - passa a receber tarefas e mensagens dos agentes.

## No escritório

- **Agentes de IA** andam entre as mesas (trabalhando), as mesas redondas (conversando) e o palco (reportando).
- **Pessoas** ficam na mesa delas, com crachá 👤. Quem está online aparece colorido; quem saiu aparece translúcido, como "ausente".
- **Minha mesa:** suas tarefas (começar, concluir ou bloquear, com resultado), mensagens recebidas com resposta e envio de arquivos.
- **Abas:** Tarefas (kanban), Conversas, Arquivos, Equipe (editar, contratar, remover, convites pendentes) e Configurar (atalhos para cada passo do onboarding e consumo).

## Integrações

Na aba **Integrações** (e no passo do onboarding) a empresa conecta cada sistema uma vez e escolhe **quais agentes** podem usá-lo e com quais permissões. Cada agente só recebe as ferramentas do que lhe foi liberado, e o acesso é checado de novo a cada chamada.

| Integração | Como conecta | Permissões por agente | Exemplo |
|---|---|---|---|
| GitHub | token fine-grained | ler código · abrir Pull Request (por repositório) | Backend lê `empresa/api` e entrega por PR |
| Resend | API key + remetente + caixas | ler caixa de entrada · responder e enviar (por caixa) | Suporte é avisado de cada e-mail em `suporte@`, lê e responde na mesma conversa |
| Gmail | OAuth Google | ler · criar rascunhos · enviar | Vendas responde clientes |
| Google Agenda | OAuth Google | ver agenda · criar eventos | PM marca reuniões |
| Railway | token de conta/workspace (+ ID do workspace opcional) | ver deploys e logs · redeploy e restart · ler/alterar variáveis (por projeto) | DevOps investiga um erro nos logs e faz restart, registrando o motivo |
| Crisp | token `identificador:chave` (plugin ou website) + Website ID | ler conversas · responder e anotar · resolver | Atendimento é avisado de cada mensagem nova do cliente e responde como operador |

- As caixas de entrada (Resend, Gmail) e o chat do Crisp são checados a cada `INBOX_POLL_SECONDS` (padrão 60s), sem precisar de webhook público. A cada e-mail ou mensagem de cliente nova, os agentes com acesso de leitura recebem um aviso e acordam. No Crisp, só avisa quando a última mensagem é do cliente, para não reagir às respostas do próprio agente.
- No Railway, valores de variáveis chegam ao agente mascarados. Redeploy, restart e alteração de variável exigem um motivo, que fica registrado no diário de obra.
- Gmail e Agenda exigem um cliente OAuth do Google: defina `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env`, com o redirect `APP_URL/integrations/google/callback`.
- Slack, WhatsApp, Notion e Linear aparecem no catálogo como "Em breve".
- Teste rápido da regra de acesso: `scripts/test-access.mjs`.

## Oficina: agentes que executam como o Claude Code

Cada **tarefa** de um agente de IA vira um trabalho numa **oficina**: um container descartável e isolado onde ele roda o **Claude Agent SDK**, o mesmo motor do Claude Code. Ali o agente:
1. planeja a tarefa em passos (o plano aparece ao vivo no cartão);
2. lê, busca e edita arquivos e usa as ferramentas do seu kit;
3. verifica o resultado antes de entregar;
4. atualiza a própria **memória**;
5. entrega.

Mensagens curtas continuam no ciclo rápido de conversa. Quando o assunto exige trabalho de verdade, o agente cria uma tarefa para si mesmo.

O motor é o mesmo para todos os cargos. Muda a **designação**: a ficha e o **kit**, que vem dos acessos e da aba **Oficina** da ficha.

| Kit | Liga quando | O que o agente ganha |
|---|---|---|
| Base | sempre | arquivos da empresa (`/work/entregas`, que voltam para Arquivos), plano, falar com a equipe, criar e atualizar tarefas, escalar, base de conhecimento |
| Código | GitHub com a permissão **Desenvolver na oficina** | clone do repositório na branch `iaorg/<tarefa>`, terminal, testes e lint, Postgres e Redis opcionais |
| Pesquisa | opção na ficha | busca e leitura de páginas na web |
| Navegador | opção na ficha | Chromium (Playwright): abrir sites e o app, clicar, tirar prints |
| Atendimento, Infra, Agenda | acesso a Resend, Gmail, Crisp, Railway ou Agenda | as ferramentas da integração, com as permissões e a aprovação de envio de sempre |

**Entrega do kit Código.** O agente só faz commits. Ao fim, o IAORG:
1. roda os testes e o lint da ficha;
2. envia a branch e abre o PR;
3. espera o CI;
4. faz **merge automático (squash)** só se os testes e o CI passarem e não houver conflito. Sem CI, o merge exige o comando de testes. Se a branch exigir revisão, ou se o merge automático estiver desligado, o PR fica em revisão e você recebe a tarefa.

Push na branch principal é bloqueado em três camadas: hook do SDK, regras de ferramenta e `pre-push`. O token do GitHub não chega ao terminal do agente.

**Arquitetura e segurança:**
- **Containers:** o serviço `runner` (`runner/server.mjs`) é o **único com acesso ao Docker**. Ele cria cada container (`workbench/`) com `--cap-drop ALL`, `no-new-privileges`, usuário sem privilégios, limites de memória, CPU e PIDs, rede própria por trabalho, tempo máximo e limpeza ao fim.
- **Credenciais:** as das integrações ficam no servidor. As ferramentas chegam ao agente via MCP, com o caminho `container → runner → app`, autenticado por trabalho.
- **Limites por tarefa (aba Oficina):** passos, custo em US$ e minutos.
- **Base de conhecimento na oficina:** vai como arquivos em `/work/conhecimento` (com `INDICE.md`), e o agente busca e lê só o que precisa. Isso deixa o prompt da oficina cerca de 60% menor.
- **Testes:** "Rodar uma tarefa de teste", na aba Oficina, executa de verdade, mas não faz merge, deploy nem evento de agenda, e os envios a clientes ficam em rascunho.
- **No cartão da tarefa:** "Cancelar" e "Pedir ajuste". O ajuste retoma a sessão anterior, na mesma branch e no mesmo PR.

Teste sem custo: `scripts/test-workbench.mjs`.

## Rotinas (tarefas e reuniões recorrentes)

Na aba **Rotinas** você configura o que se repete na empresa: **quem** faz, **o quê** (instruções) e **quando**.

**Agenda:**
- todos os dias, dias úteis, dias da semana escolhidos ou mensal, sempre num horário;
- usa o fuso `COMPANY_TZ` (padrão `America/Sao_Paulo`).

**Tipos:**
- **Tarefa:** no horário, vira uma tarefa para o agente, que executa na oficina e entrega na pasta configurada. Exemplos: relatório de atendimento toda segunda, monitoramento de infra toda terça às 10h.
- **Reunião:** os participantes vão para a sala de reunião no escritório 3D.
  - Cada agente fala com base no que fez de verdade (log de atividade e tarefas abertas).
  - Pessoas participam enviando a atualização antes, pelo card da rotina.
  - O facilitador fecha com uma ata: resumo, decisões, bloqueios e encaminhamentos. Se a opção estiver ligada, os encaminhamentos viram tarefas.
  - A ata vai para Arquivos (e para o Drive, se conectado).

**Modelos prontos:** daily, relatório de atendimento, monitoramento de infra, relatório de marketing e rotina em branco. Tudo é editável.

**Histórico:** cada execução guarda a conversa e a ata, ou a tarefa e a entrega, para consulta depois.

**Botões:** "Rodar agora", "Pausar/Ativar" e "Pular a próxima".

**Regras:**
- nada roda com a empresa pausada;
- se o servidor estava fora do ar no horário, a rotina roda ao voltar (até 2 h de atraso) ou é registrada como pulada.

**Teste da agenda:** `scripts/test-routines.mjs`.

## WhatsApp (Kapso) e Google Ads

**WhatsApp via [Kapso](https://kapso.ai):**
- **Conectar:** cole a API key do projeto no Kapso. O IAORG lista os números do projeto e você escolhe qual os agentes atendem.
- **Mensagem nova:** a cada minuto o IAORG avisa quem tem acesso de leitura, com nome e telefone do cliente.
- **Ferramentas do agente:**
  - `whatsapp_recent` e `whatsapp_messages`: leem as conversas e o histórico;
  - `whatsapp_reply`: responde e marca a mensagem do cliente como lida.
- **Janela de 24 horas:** texto livre só vai até 24 h depois da última mensagem do cliente. Fora disso a resposta é recusada e o agente escala, porque só um template aprovado pela Meta pode reabrir a conversa.
- **Envio:** o canal **WhatsApp** aparece na ficha, em "Escalonamento e envio", com rascunho para aprovação (padrão) ou envio automático.
- **Conversas:** os avisos aparecem na aba Conversas, no filtro Clientes.

**Google Ads:**
- **Conectar:** é OAuth do Google, com o mesmo cliente do Gmail, da Agenda e do Drive (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`), com o escopo `adwords`.
- **Projeto do Google Cloud:** ative a Google Ads API e peça o nível **Explorer** (aprovação quase sempre automática). Desde 9/9/2026 não existe mais developer token: o acesso é do projeto do Cloud.
- **Conta:** depois de conectar, escolha a conta de anúncios. Contas de administrador (MCC) mostram as contas abaixo delas.
- **Ferramentas do agente:**
  - `ads_report`: campanhas, grupos ou termos de pesquisa, com custo, cliques, CTR, CPC, conversões e CPA;
  - `ads_query`: GAQL livre, só `SELECT`;
  - `ads_campaign_status`, `ads_set_budget` e `ads_add_negative`: mudanças de campanha.
- **Aprovação obrigatória:** as mudanças **sempre** vão para Minha mesa → Aprovações, com a campanha, o estado atual e o motivo do agente. Só valem depois do seu ok, e são registradas no diário com o antes e o depois.
- **Versão da API:** `GOOGLE_ADS_API_VERSION` (padrão `v26`).

Teste sem rede: `scripts/test-whatsapp-ads.mjs`.

## Arquivos da empresa

A aba **Arquivos** é o arquivo da empresa.

**Navegar e ver:**
- árvore de pastas, busca e lista com tamanho, data e autor (agente ou pessoa, com a tarefa);
- prévia de imagem, PDF, vídeo, áudio, Markdown (formatado), CSV (tabela), JSON e texto. Os demais tipos têm download.

**Organizar:**
- enviar arquivos (até 25 MB), inclusive arrastando do computador;
- nova pasta;
- arrastar arquivos e pastas para mover;
- renomear e mover pelo caminho;
- excluir: o arquivo vai para `.lixeira/` no servidor.

**Agentes:** os agentes organizam o arquivo sozinhos. Na oficina eles criam pastas por área e assunto (Financeiro/, Marketing/, Estrategia/…), reaproveitam as pastas que já existem e dão nomes com data. Também mantêm um `LEIAME.md` por pasta e podem mover, renomear e apagar com `criar_pasta`, `mover_arquivo` e `apagar_arquivo`. O que um agente move ou apaga só é refletido no arquivo real se o original não tiver mudado desde o início da tarefa, e o que sai vai para a lixeira.

**Google Drive:** a integração Google Drive (Integrações) espelha tudo numa pasta **"IAORG — &lt;empresa&gt;"** do seu Drive:
- mantém as mesmas pastas e atualiza a cada mudança;
- o que sai daqui vai para a lixeira do Drive;
- usa o escopo `drive.file`: o IAORG só enxerga o que ele mesmo criou no Drive;
- o estado e o botão "Sincronizar agora" ficam no topo da aba Arquivos;
- exige `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env`, igual ao Gmail e à Agenda, com a **Google Drive API** ativada no projeto do Google Cloud.

## Ficha do agente e base de conhecimento

Cada agente de IA tem uma ficha (Equipe → agente → Ficha do agente):

- **Instruções:** persona, tom, formato e regras fixas.
- **Procedimentos:** playbooks por situação.
- **Exemplos:** 3 a 5 conversas-modelo. Entram no fim do prompt, em `<examples>`.
- **Conhecimento:** coleções da base da empresa. Até ~60 mil tokens a base vai inteira no prompt, em `<documents>`, com cache; acima disso o agente ganha a ferramenta `buscar_conhecimento` (BM25).
- **Variáveis:** `{{nome}}` fixas preenchidas na ficha. `{{empresa}}`, `{{site}}` e `{{nome_agente}}` são automáticas. `{{canal}}`, `{{caixa_destino}}`, `{{nome_cliente}}` e `{{email_cliente}}` vêm em cada mensagem recebida.
- **Escalonamento e envio:**
  - define a pessoa que recebe os casos escalados (ferramenta `escalar_para_humano` ou linha `[ESCALAR] motivo`);
  - define o modo de envio por canal: rascunho para aprovação (padrão) ou automático. Rascunhos aparecem em **Minha mesa → Aprovações**.
- **Modelo:** modelo e profundidade só deste agente.
- **Testar:** simulador com o prompt real; nada é enviado.
- **Histórico:** as últimas 15 versões, com restauração.

A base de conhecimento (Equipe → Base de conhecimento) aceita:
- `.md`: cada `##` vira um trecho; com frontmatter, o arquivo inteiro é um trecho;
- `.jsonl`: `id, titulo, categoria, planos, perguntas, texto`;
- `.txt`.

Teste: `scripts/test-knowledge.mjs <arquivo>`.

## Acesso por IA (servidor MCP)

O IAORG expõe um servidor MCP em `POST /mcp` (Streamable HTTP, sem sessão). Com ele, o Claude Code, o Claude Desktop, o Cursor ou outra ferramenta de IA configura e opera a empresa. Exemplo de pedido: *"Contrate um CTO que responde ao fundador e passa demanda para os devs"*.

1. Em **Ajustes → Acesso por IA (MCP)**, crie um token com um nome (onde vai usar) e um nível. O token aparece **uma única vez**; só o hash fica guardado.
2. No Claude Code:

   ```bash
   claude mcp add --transport http iaorg http://localhost:3000/mcp --header "Authorization: Bearer iaorg_..."
   ```

   Em outras ferramentas, use a URL `…/mcp` e o cabeçalho `Authorization: Bearer iaorg_...`.

### Plugin para o Claude Code

O repositório também é um marketplace de plugins do Claude Code. O plugin `iaorg` traz:
- a conexão MCP já configurada;
- a skill que ensina o Claude a operar a empresa: por onde começar, o que pede confirmação e como ler o organograma;
- a skill `/iaorg:conectar`, que diagnostica a conexão.

```bash
claude plugin marketplace add leandrolima123/iaorg
```

Depois, numa sessão do Claude Code, rode `/plugin install iaorg@iaorg`. O Claude Code pede dois valores:
- **endereço do IAORG**, por exemplo `http://localhost:3000`;
- **token**, que fica guardado no cofre de credenciais do sistema, não no `settings.json`.

Para trocar esses valores depois, use `/plugin configure iaorg@iaorg`. Pelo terminal, sem diálogo:

```bash
claude plugin install iaorg@iaorg --config iaorg_url=http://localhost:3000 --config iaorg_token=iaorg_...
```

Os arquivos ficam em [`plugins/iaorg/`](plugins/iaorg) e o catálogo em [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json).

| Nível | Ferramentas |
|---|---|
| Leitura | `empresa_resumo`, `catalogo`, `agente_ficha`, `tarefas_listar`, `tarefa_ver`, `aprovacoes_listar`, `conversas_listar`, `conversa_ler`, `agente_log`, `rotinas_listar`, `rotina_execucao`, `arquivos_listar`, `arquivo_ler`, `integracoes_listar` |
| Operação | + `tarefa_criar`, `tarefa_atualizar`, `tarefa_ajuste`, `mensagem_enviar`, `rotina_rodar` |
| Administração | + `agente_contratar`, `agente_editar`, `agente_demitir`, `agente_ficha_editar`, `acesso_definir`, `empresa_editar`, `rotina_salvar`, `rotina_remover`, `aprovacao_decidir`, `obra_controle` |

**Regras:**
- O token age em nome de quem o criou e nunca passa do papel dessa pessoa: um membro só cria tokens de leitura ou operação.
- As ferramentas chamam a própria API do IAORG, com as mesmas validações e aprovações da interface.
- O diário registra a origem, por exemplo "Leandro (via Claude Code do notebook) contratou…".
- Ações destrutivas, como demitir ou remover uma rotina, exigem `confirmar: true`.
- **Nunca por token:**
  - chave do Claude;
  - conectar ou desconectar integrações;
  - criar ou revogar tokens;
  - mudar o papel de acesso de pessoas;
  - logo, onboarding;
  - "limpar trabalho".
- Limite de 120 chamadas por minuto por token.
- Revogue o token em Ajustes quando quiser; ele perde o acesso na hora.

## Custos, cache e Painel

**Preço:** o custo de cada chamada é calculado com o preço do modelo:
- a leitura de cache sai a 5% do preço de entrada no Sonnet/Opus 5.5, 2,5% no Fable 5.2 e 10% no Haiku;
- a gravação de cache custa 1,25× (5 min) ou 2× (1 h).

**Livro de custos:** o custo vai para um livro diário por agente e por tipo (conversas, oficina, reuniões, simulador e cache mantido).

**Cache do prompt de cada agente:** o prompt de sistema tem duas partes:
- **fixa:** base, instruções, regras e exemplos, com cache de 1 h;
- **que muda às vezes:** memória e organograma. Aprender algo novo só regrava essa parte.

O cache automático cobre a conversa.

**Mantenedor do cache:** no expediente (seg–sex, 8h–18h, ajustável em `settings.cacheHours`), ele renova o cache dos agentes que conversaram nos últimos 3 dias antes de o cache vencer, com uma requisição `max_tokens: 0`.
- Ele só renova cache ainda vivo: a primeira conversa do dia grava, e daí em diante o mantenedor segura o cache.
- Desligue com `settings.cacheKeepAlive: false`, ou use `IAORG_CACHE_TTL=5m` para o cache curto.

**Painel (aba Painel, administradores):** a "folha de pagamento" dos agentes:
- custo por agente e por tipo, tarefas concluídas, custo por tarefa, horas na oficina, PRs e mensagens a clientes;
- taxa de acerto do cache;
- filtros de período e exportação em CSV.

**Falhas temporárias da API:** em erro 5xx, sobrecarga, limite ou rede, a mensagem volta para a fila e o agente tenta de novo em 1, 3 e 10 min. Se ele já tinha agido, não repete, para não duplicar envios.

Teste do cache (gasta poucos centavos): `node scripts/test-cache.mjs <empresa> <agenteId>`.

## Marca e modelo de e-mail

A aba **Marca** guarda a identidade da empresa:
- **Identidade visual:** logo, cor principal, cor do texto, fundo e fonte (só fontes seguras para e-mail).
- **Tom de voz:** entra no prompt de todos os agentes, em e-mail, chat e WhatsApp.
- **Modelo de e-mail:**
  - topo com o logo (largura e alinhamento);
  - assinatura com `{{nome}}`, `{{cargo}}`, `{{empresa}}`, `{{site}}` e `{{telefone}}`, preenchida com o agente que enviou;
  - telefone, nota de resposta, links (site e redes), rodapé e aviso legal (LGPD);
  - prévia ao vivo, assinada por qualquer agente.

**No envio:** o agente escreve só o corpo. Na hora de enviar (Resend ou Gmail, inclusive rascunhos aprovados), o IAORG monta o e-mail em HTML com versão em texto puro.
- O logo vai **embutido** (Content-ID), sem depender de imagem hospedada.
- Ele nunca é esticado além do tamanho real.
- A página avisa quando o logo é pequeno demais ou está em WEBP, formato que o Outlook não mostra.

## Papéis

| Papel | Pode |
|---|---|
| Dono | tudo, incluindo a chave do Claude e o token do GitHub |
| Administrador | editar empresa, equipe, convites e repositórios; pausar e limpar o trabalho |
| Membro | trabalhar: tarefas, mensagens, objetivos e arquivos |

## Segurança

- Login OIDC (Authorization Code + PKCE) no padrão BFF: os tokens ficam no servidor e o navegador recebe só um cookie `HttpOnly` assinado.
- A chave do Claude e o token do GitHub de cada empresa são cifrados com AES-256-GCM, usando `APP_SECRET`.
  - Se `APP_SECRET` não estiver definido, o app gera um em `data/secret.key`. Defina o seu em produção e **não troque depois**.
- Cada empresa tem pasta, workspace, logo e agentes próprios. Todas as rotas validam a empresa pela sessão ou pelo token pessoal (`Bearer iaorg_...`), que é limitado por nível e por uma lista de rotas proibidas.
- No ciclo de conversa, os agentes não executam código. Código só roda na oficina, em containers isolados criados pelo `runner`, o único serviço com acesso ao Docker. Credenciais das integrações nunca entram no container.

## Tema de login (identidade visual)

As telas de login, cadastro e recuperação de senha usam o tema **`iaorg`** (`keycloak/themes/iaorg/login`). Ele herda o `keycloak.v2` do Keycloak e aplica:
- a paleta, a fonte e os cartões de vidro do app;
- o painel de apresentação com a ilustração do escritório;
- textos em pt-BR.

| Arquivo | O que muda |
|---|---|
| `resources/css/iaorg-v6.css` | cores, botões, campos, layout (versão no nome do arquivo) |
| `messages/messages_pt_BR.properties` | textos (títulos, frases do painel) |
| `template.ftl` | estrutura (cópia do `keycloak.v2` 26.4 com a marca e o painel) |
| `theme.properties` | herança e `iaorgThemeVersion` |

O tema fica **dentro da imagem** do Keycloak (`keycloak/Dockerfile`), e não numa pasta montada. Assim ele não some se o Docker subir antes de a pasta do projeto estar disponível (comum no WSL). Ao iniciar, o app também confere se o realm usa o tema `iaorg` e corrige se não estiver.

Depois de editar o tema, reconstrua o Keycloak:

```bash
docker compose up -d --build keycloak
```

**Ao mudar o CSS, renomeie o arquivo** (ex.: `iaorg-v6.css` → `iaorg-v7.css`) e atualize a linha `styles=` do `theme.properties`. O Keycloak manda o navegador guardar `/resources` em cache por 30 dias. Um nome de arquivo novo força o download em qualquer navegador; só mudar o `?v=` não basta em todos.

O `template.ftl` é uma cópia do tema padrão do Keycloak 26.4. Ao atualizar a versão do Keycloak, compare-o com o original.

## Variáveis (`.env`)

Veja `.env.example`. As principais:
- `APP_URL` e `KEYCLOAK_PUBLIC_URL`: como o navegador acessa;
- `APP_SECRET`;
- `KEYCLOAK_CLIENT_SECRET` e `KEYCLOAK_ADMIN_CLIENT_SECRET`;
- `KC_ADMIN_PASSWORD` e `POSTGRES_PASSWORD`;
- `MAX_CONCURRENT_AGENTS` e `AGENT_MAX_STEPS`.

Em produção, coloque o app e o Keycloak atrás de HTTPS e ajuste `APP_URL`/`KEYCLOAK_PUBLIC_URL`. Para outro domínio, atualize também os redirect URIs do client `iaorg-app` no Keycloak.

## Desenvolvimento

`keycloak/dev-test-users.md` (fora do Git) lista usuários de teste do Keycloak local. Eles são criados manualmente via Admin API e não fazem parte do realm importado.

```
server/
  index.js           rotas HTTP + WebSocket
  auth.js            OIDC com Keycloak + sessões
  keycloak-admin.js  Organizations, membros e tema do realm (Admin API)
  companies.js       armazenamento por empresa
  engine.js          motor dos agentes (por empresa), ferramentas, cache e agendador
  llm.js             Claude API por empresa (modelos, custo, cache, modo simulado)
  workbench.js       oficina: envia tarefas ao runner e recebe entregas
  integrations.js    integrações e permissões por agente
  brand.js           marca, tom de voz e modelo de e-mail
  dashboard.js       painel de custos (folha de pagamento)
  routines.js        rotinas e reuniões
  mcp.js             servidor MCP (acesso por IA)
  github.js          repositórios, PRs, CI e merge
  secrets.js         criptografia e assinatura
  templates.js       catálogo de cargos e templates de organograma
public/
  login.html, invite.html, onboarding.html/.js, index.html, app.js, office.js (escritório 3D),
  dashboard-ui.js, brand-ui.js, chat-ui.js, files-ui.js, integrations-ui.js, agent-profile.js
runner/              cria e controla os containers de tarefa (único com acesso ao Docker)
workbench/           imagem e worker da oficina (Claude Agent SDK)
keycloak/
  Dockerfile                Keycloak com o tema embutido
  import/iaorg-realm.json   realm importado na primeira subida
  themes/iaorg/login/       tema de login com a identidade do IAORG
scripts/             testes (acesso, conhecimento, rotinas, oficina, cache…) e gerador das capas das demos
site/                servidor só da landing com lista de interesse (para publicar separado do app)
plugins/iaorg/       plugin do Claude Code (MCP + skills)
```

## Contribuir

Contribuições são bem-vindas. Leia o [CONTRIBUTING.md](CONTRIBUTING.md) para preparar o ambiente, rodar os testes e abrir um Pull Request. O projeto segue o [Código de Conduta](CODE_OF_CONDUCT.md). Falhas de segurança vão pelo reporte privado descrito no [SECURITY.md](SECURITY.md), nunca em issue pública.

## Licença

Código sob a [licença MIT](LICENSE). Os personagens e móveis 3D (KayKit) e os logos de integrações (Simple Icons) são CC0. As fontes Archivo e Barlow Condensed usam a SIL Open Font License. Os nomes e logos de serviços de terceiros pertencem aos seus donos.
