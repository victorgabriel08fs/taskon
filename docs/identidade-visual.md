# Identidade visual da Raia

> Direção escolhida pelo Victor em 22/11/2026: **A · Grafite e lima**. Este arquivo é a fonte da reformulação visual: o design system (tokens no Tailwind v4), os ícones, a splash e as telas seguem o que está aqui. Mudou a direção, mude aqui primeiro.

## 1. Conceito

**Nome.** Raia, a faixa de cada corredor na pista: cada coluna do quadro é uma raia e cada tarefa corre na sua. Segue o padrão da tríade (Taskon virou Raia, ao lado de Prumo e Ara): uma palavra curta em português, um objeto concreto, wordmark em minúsculas. Slogan: **Cada tarefa na sua raia.**

Sóbrio e focado. A Raia é ferramenta de trabalho diário: o fundo grafite some, os cards aparecem, e uma única cor, o **lima**, marca o que é ação (o botão principal, o foco, o card selecionado). Continua o tom escuro atual (`#1E2327`, o `theme-color` de hoje), troca o violeta por lima e tira os gradientes.

- **Escuro primeiro.** O tema escuro é o padrão; o claro existe e tem o mesmo cuidado.
- **Lima só na ação.** Nunca em texto corrido, fundo grande ou estado (sucesso, erro, aviso).
- **Plano.** Sem gradiente, sem brilho; profundidade por camadas de cor e borda, sombra só no que flutua (menus, modal, card sendo arrastado).
- **Cor nunca sozinha.** Etiqueta, prazo e estado sempre com texto ou ícone junto.

## 2. Símbolo e logotipo

- **Símbolo** (`docs/marca/raia-simbolo.svg`, grade de 64): quadrado grafite de cantos 14 com três colunas que descem da esquerda para a direita, como um quadro em andamento. A primeira é lima (o que está acontecendo), a segunda off-white e a terceira off-white a 50%.
- **Nome** (`raia-nome-escuro.svg` e `raia-nome-claro.svg`): `raia` desenhado em minúsculas, traço único de 10 na grade do símbolo, terminais arredondados como os cantos das colunas. O pingo do `i` é o único ponto de cor: lima no escuro, lima escura `#4A6100` no claro (é o marcador da raia). Não é fonte digitada: use sempre o SVG; em texto corrido, "Raia" (feminino: "a Raia", "na Raia").
- **Logotipo** (`raia-logo-escuro.svg` e `raia-logo-claro.svg`): símbolo seguido do nome. A altura do x vai do topo das colunas ao pé da coluna lima (metade do símbolo), e o espaço entre os dois é um quarto do símbolo. No app: `<Logo />` em `src/components/logo.tsx`.
- **Aplicação**: nome em off-white `#F4F5F0` sobre escuro e grafite `#1E2327` sobre claro. Favicon, ícones do PWA e `apple-touch-icon` saem do símbolo (os de tela cheia, da versão maskable).
- **Variações**: maskable (`raia-simbolo-maskable.svg`, símbolo a 78% dentro da zona segura, fundo sem cantos) e monocromático (`raia-monocromatico.svg`, só as colunas, para badge e `monochrome` do manifesto).
- **Não fazer**: girar, trocar a cor das colunas, pôr a coluna lima em outra posição, aplicar sobre foto ou gradiente.

## 3. Cores

Contraste WCAG 2.x medido sobre `--surface` (e sobre `--background` entre parênteses): texto ≥ 4,5:1, componentes ≥ 3:1.

### Escuro (padrão)

| Token | Valor | Contraste | Uso |
|---|---|---|---|
| `--background` | `#15191C` | | fundo da página |
| `--surface` | `#1E2327` | | cards, colunas, cabeçalho |
| `--surface-2` | `#262C31` | | card sobre coluna, campo |
| `--surface-3` | `#2F363C` | | hover, selecionado |
| `--border` | `#3A424A` | 1,55 | divisória (decorativa) |
| `--border-strong` | `#737D86` | 3,78 (4,22) | contorno de campo e controle |
| `--foreground` | `#F4F5F0` | 14,47 (16,14) | texto |
| `--muted-fg` | `#A3AAB1` | 6,75 (7,53) | texto secundário, metadados |
| `--primary` | `#C6F135` | 12,1 (13,5) | botão principal, foco, seleção |
| `--primary-fg` | `#15191C` | 13,5 sobre o lima | texto sobre o lima |
| `--success` | `#6FD39B` | 8,65 | concluído |
| `--danger` | `#FF8070` | 6,47 | erro, prazo vencido, excluir |
| `--warning` | `#F5B94A` | 9,0 | prazo próximo |

### Claro

O lima não tem contraste sobre branco, então no claro ele aparece só dentro do grafite: o botão principal é grafite com texto lima, e foco, link e seleção usam a lima escura.

| Token | Valor | Contraste | Uso |
|---|---|---|---|
| `--background` | `#F4F5F0` | | fundo da página |
| `--surface` | `#FFFFFF` | | cards, colunas |
| `--surface-2` | `#ECEEE8` | | campo, card sobre coluna |
| `--surface-3` | `#E2E5DE` | | hover, selecionado |
| `--border` | `#DDE0D8` | 1,34 | divisória (decorativa) |
| `--border-strong` | `#8A928B` | 3,2 (2,92) | contorno de campo; sobre `--background`, campos ficam em `--surface` |
| `--foreground` | `#1E2327` | 15,85 | texto |
| `--muted-fg` | `#5A626A` | 6,19 (5,65) | texto secundário |
| `--primary` | `#4A6100` | 7,0 (6,39) | foco, link, seleção |
| `--primary-button` | `#1E2327` com texto `#C6F135` | 12,1 | botão principal |
| `--success` | `#1D7F4E` | 5,0 | concluído |
| `--danger` | `#C0392B` | 5,44 | erro, prazo vencido, excluir |
| `--warning` | `#9A5B00` | 5,43 | prazo próximo |

### Fundos dos quadros

Os oito gradientes viram oito cores sólidas, todas com texto branco ≥ 6,5:1:

| Nome | Valor | Branco |
|---|---|---|
| Grafite | `#2F363C` | 12,25 |
| Oliva | `#4A5A1F` | 7,57 |
| Petróleo | `#1F4E5A` | 9,15 |
| Ameixa | `#4E2F4F` | 11,39 |
| Terracota | `#7A3B2E` | 8,43 |
| Azul-noite | `#26365C` | 11,9 |
| Musgo | `#3B5244` | 8,48 |
| Areia | `#6B5A3A` | 6,67 |

Etiquetas e capas de card: definir no design system, com par claro/escuro medido e sem usar o lima.

## 4. Tipografia

- **Geist** (troca a Instrument Sans) na interface, pesos 400, 500 e 600; **Geist Mono** em números que se comparam (contagens, datas, ritmo do dashboard, atalhos).
- Escala: a do Tailwind (`text-xs` a `text-3xl`); títulos de página `text-2xl` 600 com `letter-spacing: -0.02em`, corpo `text-sm`.
- Sem 700. Campos com 16 px no celular (evita o zoom do iOS).

## 5. Forma e movimento

- Raio base `0.75rem` (12 px): botões e campos `rounded-lg`, cards e colunas `rounded-xl`, avatares e chips redondos.
- Sombra só no que flutua; o card sendo arrastado ganha sombra e `scale(1.02)`.
- Movimento curto (150 a 250 ms), só `transform` e `opacity`, e nada além de fade com `prefers-reduced-motion`.

### Animações da marca

Ligadas às formas e cores do símbolo, como no Prumo: tocam uma vez, partem de um gatilho (carregar, passar o mouse, concluir) e nunca ficam em loop. Com `prefers-reduced-motion`, tudo aparece no estado final.

- **Largada** (`<Logo animated />`, na home e nas telas de entrada): as três colunas descem do topo em sequência, a lima primeiro (500 ms cada, 90 ms entre elas), e o pingo lima do `i` cai por último, como o sinal de largada.
- **Passo** (hover no logo): as colunas avançam uma posição e voltam (360 ms), uma vez por passagem do mouse.
- **Carregando** (`<RaiaLoader />`): as três colunas sobem e descem em sequência. É o único loop da marca, e só enquanto algo carrega (painel, quadros).
- **Esqueleto** (`.raia-skeleton`): no lugar do pulso, uma faixa lima clara corre a raia de cima a baixo.
- **Largada do quadro**: ao abrir, as colunas descem do topo uma depois da outra (70 ms entre elas) e os cards entram na raia logo em seguida.
- **Chegada**: card criado ou solto em outra coluna entra descendo na raia.
- **Concluído**: quando o card conclui, a faixa lima corre o card da esquerda para a direita e o pingo cai no canto. Só na mudança, nunca ao abrir o quadro.
- **Vazio** (`<RaiaEmpty />`): três raias tracejadas descem e o pingo cai na primeira (coluna sem cards, gaveta de arquivados, painel sem prazos ou quadros).
- **Toast**: a raia lima desce pela borda esquerda ao chegar.
- **Navegação**: a barra de progresso leva o pingo lima na ponta.
- **Progresso**: a barra do cartão do quadro enche como uma coluna.
- **404**: a terceira coluna sai da raia.
- Tempos e curvas ficam só em `src/app/globals.css` (blocos "Marca"). Próximas: o fio lima acompanhando a rolagem da home.

## 6. Próximas etapas

1. Design system: os tokens acima no CSS (Tailwind v4), com os nomes atuais de `globals.css` mantidos onde der.
2. Aplicar tokens, logo, favicon, ícones, Open Graph, `theme-color`, manifesto, atalhos e splash do iOS.
3. Telas: board e card, dashboard, auth, landing, admin e e-mails.
4. Revisão de contraste e foco.
