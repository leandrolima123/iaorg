# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Fundadores e donos de pequenas e médias empresas (PMEs e startups) que querem uma equipe de agentes de IA para tirar projetos do papel, sem precisar saber programar a fundo. Eles convidam também algumas pessoas reais (sócios, freelancers, funcionários) para trabalhar junto com os agentes.

## Product Purpose

O IAORG é um escritório virtual onde uma empresa funciona com agentes de IA (CEO, CTO, PM, devs, marketing, etc.) e pessoas reais no mesmo organograma. O dono dá um objetivo; os agentes planejam, criam e delegam tarefas entre si e para as pessoas, escrevem documentos e código e reportam o resultado. Sucesso é o dono ver trabalho real sendo entregue (arquivos, Pull Requests, respostas) com pouco esforço de coordenação.

## Positioning

A empresa inteira — agentes e humanos — aparece como personagens num escritório isométrico 3D: dá para ver quem está trabalhando, conversando ou reportando, em tempo real. Agentes e pessoas dividem o mesmo quadro de tarefas e o mesmo organograma, e entregas de código chegam como Pull Requests nos repositórios do cliente.

## Operating Context

- Uso principal: painel de trabalho diário, aberto o dia todo. O dono acompanha o feed de atividade, responde mensagens dos agentes, revisa entregas e dá novos objetivos. Clareza e rapidez valem mais que efeito visual.
- Multiempresa (SaaS): cada cliente cria a própria empresa; login, cadastro e convites via Keycloak.
- Fluxo de entrada: criar conta → onboarding (empresa e contexto, seu personagem, chave do Claude, repositórios GitHub, equipe e convites) → escritório.
- Pessoas convidadas usam "Minha mesa" para ver tarefas atribuídas, concluir com resultado e responder mensagens.

## Capabilities and Constraints

- Web app sem framework: HTML/CSS/JS puro + Three.js (escritório 3D), servido por Node/Express em Docker. Tempo real via WebSocket.
- Telas: landing de login, convite, onboarding em 6 passos, escritório (abas Escritório, Minha mesa, Tarefas, Conversas, Arquivos, Equipe, Configurar), telas do Keycloak (tema próprio).
- Papéis: dono, administrador, membro.
- Os agentes usam a API do Claude com a chave de cada empresa; sem chave, rodam em modo simulado.
- Idioma da interface: português do Brasil.

## Brand Commitments

- Nome do produto: **IAORG** (manter).
- O escritório isométrico 3D com avatares é o coração do produto e permanece.
- Símbolo, cores e tipografia estão livres para redesenho. O visual atual (fundo azul-escuro com vidro, azul `#3d8bfd` + laranja) é considerado genérico, "com cara de feito por IA", e não deve ser mantido.

## Evidence on Hand

Não há depoimentos, clientes, métricas ou preços reais. Nenhuma tela deve inventar esses dados.

## Product Principles

1. O trabalho é o protagonista: o que os agentes e as pessoas estão fazendo deve ser legível de relance.
2. Agentes e humanos são colegas iguais no produto; a interface nunca trata pessoas como "usuários de fora".
3. Pouco esforço para o dono: cada tela leva ao próximo passo útil (dar um objetivo, responder, revisar).
4. Confiança antes de impressão: custos, chaves e permissões sempre claros.
