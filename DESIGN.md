---
name: IAORG
description: Escritório virtual onde agentes de IA e pessoas tocam a empresa como uma obra.
colors:
  concrete: "#dfe0dd"
  concrete-deep: "#cfd1cd"
  paper: "#f3f4f2"
  white: "#ffffff"
  ink: "#1c1d1c"
  ink-soft: "#3b3c39"
  muted: "#5f5e59"
  hair: "#c2c4bf"
  rail-text: "#b9b7b0"
  signal-yellow: "#f2c200"
  signal-yellow-deep: "#d9ad00"
  plate-green: "#1f6b4a"
  plate-green-text: "#cfe3d7"
  cone-orange: "#b8401c"
  cone-orange-soft: "#fbe7df"
  doing-amber: "#8a6a00"
typography:
  display:
    fontFamily: "Barlow Condensed, Archivo, sans-serif"
    fontSize: "40px"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "0.02em"
  headline:
    fontFamily: "Barlow Condensed, Archivo, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "0.04em"
  title:
    fontFamily: "Barlow Condensed, Archivo, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "0.06em"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Barlow Condensed, Archivo, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.12em"
rounded:
  none: "0px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "14px"
  lg: "22px"
components:
  button-primary:
    backgroundColor: "{colors.signal-yellow}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 14px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.signal-yellow-deep}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 14px"
    height: "38px"
  button-danger:
    backgroundColor: "{colors.white}"
    textColor: "{colors.cone-orange}"
    rounded: "{rounded.none}"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "9px 11px"
    height: "40px"
  site-plate:
    backgroundColor: "{colors.plate-green}"
    textColor: "{colors.white}"
    rounded: "{rounded.none}"
  rail:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.rail-text}"
    width: "84px"
  panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "22px 24px"
---

# Design System: IAORG

## Overview

**Creative North Star: "O Canteiro de Obra"**

A empresa do cliente é uma obra em andamento e o painel é o canteiro. Cada objetivo vira uma placa de obra verde com responsável, equipe, início e uma régua de "executado"; o feed é o diário de obra; os estados das tarefas são carimbados. A interface é um painel de trabalho diário (modo Operate): denso, legível de relance, com o mundo entrando só por tipo, paleta, densidade e um movimento-assinatura.

O chão é concreto cinza neutro, o texto e as réguas são grafite, e o amarelo de sinalização aparece apenas onde se pode agir. Cantos retos e réguas de 2px dão a estrutura de chapa e andaime; nada de vidro, brilho ou gradiente. O visual anterior (azul-escuro com vidro e acento neon) é a anti-referência declarada.

**Key Characteristics:**
- Placa de obra verde como cabeçalho do objetivo ativo, com régua segmentada de executado.
- Amarelo de sinalização reservado ao acionável e à régua de executado.
- Estados de tarefa como carimbos (Concluída, Bloqueada, Fazendo, A fazer).
- Cantos retos, bordas de 2px grafite, sombras curtas com desfoque só em ação e placa.
- Barlow Condensed em caixa alta para placas e títulos; Archivo para leitura e controles.

## Colors

Concreto e grafite estruturam; amarelo, verde e laranja-cone só carregam significado.

### Primary
- **Amarelo de Sinalização** (signal-yellow): botão primário, segmentos preenchidos da régua de executado, contador da "Minha mesa", seleção de texto e anel de foco. Hover escurece para o amarelo profundo.

### Secondary
- **Verde Placa de Obra** (plate-green): fundo da placa do objetivo, carimbo "Concluída", presença online, selo do modelo Claude ativo. O texto secundário sobre a placa usa o verde-claro de placa (plate-green-text), nunca cinza.

### Tertiary
- **Laranja-Cone** (cone-orange): carimbo "Bloqueada", erros, botão de demitir/remover; fundo suave (cone-orange-soft) em linhas de erro.
- **Âmbar de Obra** (doing-amber): carimbo tracejado "Fazendo/Em revisão".

### Neutral
- **Concreto** (concrete): fundo da página. **Concreto Fundo** (concrete-deep): moldura do canteiro 3D.
- **Papel de Obra** (paper): painéis, diário, cartões de formulário. **Branco** (white): campos, tarefas, listas.
- **Grafite** (ink): texto, todas as bordas de 2px, trilho de navegação. **Grafite Suave** (ink-soft) e **Cinza Obra** (muted): texto secundário. **Fio** (hair): divisórias de 1px.

### Named Rules
**The Sinal Só no Acionável Rule.** O amarelo nunca é decoração: se está amarelo, dá para clicar, ou é a régua de executado.
**The Concreto Não É Creme Rule.** O fundo é cinza neutro; tons quentes de creme/bege são proibidos no chão.
**The Fita Zebrada Rule.** As listras amarelo/grafite aparecem apenas na placa quando a obra está pausada; é um estado, nunca textura.

## Typography

**Display Font:** Barlow Condensed (com Archivo)
**Body Font:** Archivo (com system-ui)

**Character:** O condensado de placa de obra dá voz a títulos, rótulos e números; o Archivo é o grotesco de trabalho para leitura longa e controles. Ambos servidos localmente.

### Hierarchy
- **Display** (800, 40px, 1.05): títulos de página de entrada e do onboarding; até 64px na landing.
- **Headline** (700, 28px, caixa alta): título de painéis (Tarefas, Equipe, Ajustes).
- **Title** (700, 17px, caixa alta, 0.06em): cabeçalhos de seção, colunas do quadro, "Diário de obra".
- **Body** (400, 14px, 1.45): texto corrido, mensagens, diário; medida máxima ~68ch nas dicas.
- **Label** (700, 12px, caixa alta, 0.12em): rótulos de campo e da placa.

### Named Rules
**The Números de Placa Rule.** Números de progresso, horários e contagens usam Barlow Condensed com algarismos tabulares.

## Layout

Grade fixa de painel: trilho de 84px à esquerda; placa de obra ocupando a largura no topo; canteiro 3D ao centro; diário de obra de 360px à direita; barra "Nova ordem" na base. Abas abrem como painéis sobre a área do canteiro, mantendo placa, diário e barra. Ritmo de 14px entre blocos, 22–24px dentro de painéis. Abaixo de 1100px o diário cai para 300px; abaixo de 860px tudo empilha (placa, canteiro, nova ordem, diário) e o trilho vira barra inferior com as sete abas em largura igual.

## Elevation & Depth

Plano por padrão: profundidade vem de bordas de 2px e camadas de papel sobre concreto. A única sombra é curta com desfoque e marca o que é ação ou placa.

### Shadow Vocabulary
- **Elevação de ação** (`box-shadow: 0 1px 0 rgba(28,29,28,.18), 0 8px 18px -10px rgba(28,29,28,.55)`): botão primário, placa de obra, cartão do agente, avisos.

### Named Rules
**The Sem Bloco Duro Rule.** Nunca sombra de bloco sem desfoque (offset sólido); o mundo é chapa e andaime, não neobrutalismo.

## Shapes

Cantos retos em tudo (0px). Bordas grafite de 2px delimitam painéis, campos, botões e tarefas; divisórias internas de 1px no tom fio. Marcadores de status são quadrados de 9px com borda, nunca barras laterais. Carimbos são retângulos de borda 2px levemente girados (-3°).

## Components

### Buttons
- **Shape:** retos (0px), borda grafite de 2px, altura 38px (30px no pequeno).
- **Primary:** amarelo de sinalização com texto grafite e elevação de ação; hover amarelo profundo.
- **Hover / Focus:** transição de fundo 160ms; ao pressionar `scale(0.97)` em 160ms com ease-out forte (`cubic-bezier(0.23,1,0.32,1)`); foco com contorno grafite + anel amarelo de 5px.
- **Secondary / Ghost / Danger:** papel com borda grafite; fantasma sem borda; perigo com borda e texto laranja-cone.

### Cards / Containers
- **Corner Style:** retos.
- **Background:** papel para painéis, branco para tarefas e listas.
- **Shadow Strategy:** plano; só a elevação de ação.
- **Border:** 2px grafite.
- **Internal Padding:** 10–11px em tarefas, 18px em editores, 22–24px em painéis.

### Inputs / Fields
- **Style:** branco, borda grafite 2px, cantos retos, 40px de altura; rótulo acima em Label.
- **Focus:** anel amarelo de 4px.
- **Error / Disabled:** mensagens em laranja-cone; desabilitado a 50% de opacidade.

### Navigation
- Trilho grafite com ícones Lucide (traço 1.75) e rótulo de 11px; aba ativa ganha fundo grafite claro e ícone amarelo. Contador amarelo na "Minha mesa". No celular vira barra inferior fixa.

### Placa de Obra (signature)
Cabeçalho verde do objetivo ativo: Obra, Responsável, Equipe na obra, Iniciada e Executado com régua de 10–24 segmentos. Quando uma tarefa conclui, só os segmentos novos preenchem da esquerda (`scaleX`, 420ms, 45ms de defasagem) e o carimbo "Concluída" bate na tarefa (escala 1.35→1, 260ms). Sem objetivo, a placa fica em papel com o próximo passo; pausada, mostra a fita zebrada.

### Carimbos
Concluída (verde, girado), Bloqueada (laranja-cone, girado), Fazendo/Em revisão (âmbar, tracejado), A fazer (cinza, pontilhado). Nada some do quadro: o estado muda o carimbo.

### Crachás da equipe
Grade densa de crachás brancos com borda grafite sobre o canteiro: marcador quadrado de status (amarelo trabalhando, verde pessoa online, fio livre/ausente), primeiro nome em Barlow e cargo/tarefa atual.

## Do's and Don'ts

### Do:
- **Do** usar o amarelo de sinalização só em ações e na régua de executado.
- **Do** carimbar estados de tarefa em vez de escondê-los ou mudar a cor do cartão.
- **Do** usar ícones Lucide do sprite local, traço 1.75.
- **Do** animar só transform/opacity, até 300ms, com ease-out forte, e respeitar `prefers-reduced-motion`.
- **Do** manter as fontes servidas localmente (Archivo e Barlow Condensed via @fontsource).

### Don't:
- **Don't** voltar ao fundo azul-escuro com vidro e acento neon do visual anterior.
- **Don't** usar fundo creme/bege quente; o chão é concreto cinza.
- **Don't** usar emoji como ícone.
- **Don't** usar barras coloridas na lateral de cartões, itens de lista ou abas.
- **Don't** usar sombra de bloco sem desfoque, gradiente em texto ou vidro decorativo.
- **Don't** pôr rótulos-sobrancelha acima de títulos.
