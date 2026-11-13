---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: ["public/onboarding.html","public/login.html","public/invite.html"]
---

# Escritório (app principal) + telas de entrada

Escopo: escritório (`public/index.html`), onboarding, landing de login, convite e tema do Keycloak. Modo: Operate — painel de trabalho diário do dono de PME.

Tarefa: acompanhar o avanço do objetivo, ler o que agentes e pessoas estão fazendo, responder e dar a próxima ordem. Estados importantes: agente pensando/trabalhando/em reunião/reportando, pessoa online/ausente, tarefa a fazer/fazendo/concluída/bloqueada, empresa pausada, modo simulado, orçamento.

## Direction contract

THESIS: A empresa é uma obra em andamento. O painel é o canteiro: cada objetivo ganha uma placa de obra com responsável, equipe e avanço; recusa o dashboard escuro de vidro com acento neon e o cartão macio sobre fundo creme.

OWN-WORLD: Chão de concreto cinza neutro (#dfe0dd), grafite (#1c1d1c) em trilho, bordas de 2px e texto; amarelo de sinalização (#f2c200) só em ações e no objetivo ativo; verde de placa de obra (#1f6b4a) para concluído e para a placa; laranja-cone (#b8401c, escurecido do #e2552b para passar contraste em texto) para bloqueado/erro. Cantos retos, réguas de 2px, sombra curta com desfoque só em botões de ação e na placa. Ícones Lucide (traço único), nunca emoji. Barlow Condensed em caixa alta para placas e títulos; Archivo para texto e controles. Estados viram carimbos (CONCLUÍDA, BLOQUEADA).

STORY: O dono entende de relance quanto da obra foi executado, quem está fazendo o quê e o que precisa dele; responde ou dá a próxima ordem sem sair da tela.

FIRST VIEWPORT: Trilho grafite de 76px à esquerda com a marca e as abas. Placa de obra verde no topo ocupando a largura: obra, responsável, equipe, iniciada, executado com régua segmentada. Centro: escritório 3D em moldura de concreto, com a grade de crachás da equipe na base. Direita (360px): Diário de obra (feed). Base: barra "Nova ordem" com campo e botão amarelo "Enviar para <agente>".

FORM: Canteiro de Obra (placa de obra + diário de obra), candidato 7 da minha lista ordenada; seed:14afa9ca4528da36. Raises: grade densa de crachás (Catálogo de Evento); estados carimbados (Carteira de Passagens); amarelo só no acionável (App Acolhedor); etapas na mesma escala (Fólio Botânico). Movimento-assinatura: a régua de executado avança segmento a segmento e o carimbo bate na tarefa ao concluir.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
