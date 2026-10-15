# Boas práticas — Taskon

Guia de como este projeto é escrito e por quê. Não é um manual genérico de
Next.js/React: cada regra aqui aponta para um arquivo real do repositório.
Se for mexer no código, leia isto antes.

Instalação, comandos, variáveis e o passo a passo do deploy estão no
[README](README.md). Aqui fica o porquê.

O Taskon nasceu em Laravel 13 + Inertia e foi migrado para Next.js sem mudar o
produto: as regras de negócio vieram junto, a tecnologia é que trocou. Quando
um comentário do código diz "o antigo `X`", `X` é a peça do Laravel que aquela
substituiu.

---

## 1. Arquitetura

```
Navegador  ──►  React 19 (Client Components: Kanban, modais, gráficos)
                     ▲
                     │  RSC + Server Actions — sem API REST, sem token no navegador
                     ▼
              Next.js 16 na Vercel ──► Server Components (páginas e layouts)
                     │                 Server Actions (mutações)
                     │                 Route Handlers (crons, /up)
                     ▼
              Postgres (Neon ou Supabase) via Drizzle — PGlite no dev e nos testes
```

**Por que Server Actions e não uma API REST?** Pelo mesmo motivo de antes ter
sido Inertia: não existe um segundo cliente. Uma API separada custaria tokens,
CORS, versionamento, validação duplicada e um estado de servidor no cliente
para sincronizar. Aqui a página é um Server Component que lê o banco direto, e
a mutação é uma função `'use server'` que o navegador chama. A autenticação é o
cookie de sessão — o mesmo que protege a página.

**Regra:** enquanto o único consumidor for este frontend, não crie Route
Handlers de API para o app. As únicas rotas desse tipo são os crons
([`src/app/api/cron`](src/app/api/cron)), chamados pela Vercel, e o health check
[`/up`](src/app/up/route.ts). Se um dia existir um app mobile, aí sim: Route
Handlers com token, chamando os MESMOS serviços de `src/server/services` — a
regra já não mora na action, então nada precisa ser reescrito.

### O caminho de uma requisição

**Leitura** — `page.tsx`/`layout.tsx` (Server Component) → `requireUser()` →
loader de `src/server/queries` → resource → props tipadas para um Client
Component.

**Mutação** — Client Component → `runAction(() => acao(dados))` →
`defineAction` (autentica → valida → serviço) → `refresh()` → a página
re-renderizada volta NA MESMA resposta, junto com o resultado da action.

### Mapa de pastas

| Caminho | Responsabilidade |
| --- | --- |
| `src/app` | Rotas do App Router. `(app)` exige sessão, `(guest)` é de visitante, `api/cron` são os agendamentos. |
| `src/server/actions` | Server Actions finas: schema zod + chamada ao serviço + aviso. [`contract.ts`](src/server/actions/contract.ts) é a lista do que o navegador pode pedir. |
| `src/server/services` | A regra de negócio: autoriza, valida regra de domínio, grava. Não importa `next/*`. |
| `src/server/queries` | Loaders das páginas. Devolvem DTOs via resources. |
| `src/server/resources` | Contrato de saída. Devolvem EXATAMENTE os tipos de [`src/types`](src/types/index.ts). |
| `src/server/policies` | Autorização pelo quadro ([`board.ts`](src/server/policies/board.ts)). |
| `src/server/auth` | Sessão, senha, rate limit. |
| `src/server/mail` | O mailer e os e-mails (HTML + texto). |
| `src/server/db` | Schema Drizzle e conexão. Ver a seção 6. |
| `src/lib` | Código sem dependência de servidor: datas no fuso do app, paleta, exportação. [`actions.ts`](src/lib/actions.ts) é o lado do navegador das actions. |
| `src/components/ui` | Primitivos reutilizáveis, sem conhecer o domínio. |
| `src/components/board`, `boards`, `dashboard` | Componentes que sabem o que é card, lista, quadro. Os gráficos estão na seção 12. |
| `src/components/layouts` | Casca das páginas (cabeçalho, navegação, painel de auth, configurações). |
| `src/proxy.ts` | Checagem otimista de sessão (seção 8). |
| `drizzle/` | Migrations SQL geradas. Ver a seção 6.3. |
| `scripts/` | O antigo `artisan`: migrate, seed, fresh, digest, archive-done. |
| `tests/` | Vitest + PGlite. Ver a seção 9. |

---

## 2. Backend

### 2.1 A action é fina; a regra mora no serviço

Uma Server Action faz três coisas: **valida a entrada, chama o serviço, devolve
o aviso**. Autenticação e `refresh()` vêm de graça do `defineAction`;
autorização e regra moram no serviço.

```ts
// src/server/actions/lists.ts
export const createList = defineAction(
    z.object({ boardId: id(), title: requiredString(120) }),       // valida
    async ({ boardId, title }, { user }) => {
        await listService.createList(user, boardId, { title });   // autoriza + persiste

        return null;
    },
) satisfies ListActions['createList'];
```

```ts
// src/server/services/lists.ts
export async function createList(actor: Pick<UserRow, 'id'>, boardId: number, input: { title: string }) {
    const { board } = await authorizeBoard(actor, boardId, 'update');   // 404 ou 403
    // ...
}
```

Por que separar: o serviço não importa `next/*`, então roda no Vitest, no
`npm run digest` e no cron sem fingir uma requisição. E a mesma regra atende a
todas as portas — a varredura dos concluídos é chamada pelo cron, pelo script e
pelo botão "Arquivar agora", e nenhuma das três pode divergir sobre o que
"passou do prazo" quer dizer ([`done-card-archiver.ts`](src/server/services/done-card-archiver.ts)).

Assinatura típica de serviço: `(ator, id do alvo, entrada já validada)`. Quando
a regra depende do relógio, `now: Date = new Date()` entra como último
parâmetro — é o que deixa o teste fixar o instante sem mock.

`src/server/queries` segue o mesmo princípio para leitura; `src/server/resources`
só dá forma ao dado, nunca consulta.

### 2.2 `defineAction`: a casca de toda mutação

[`src/server/action.ts`](src/server/action.ts) é o que no Laravel era o trio
middleware + Form Request + handler de exceção:

```
autentica → valida (zod) → executa → refresh() → ActionResult
```

- **`refresh()`** re-renderiza a página atual no servidor e a manda junto com a
  resposta da action. É o `return back()` do Inertia: o cliente não busca nada
  depois de mutar, e a tela nunca fica com dado velho.
- **`HttpError` vira `ActionResult`** (`{ ok: false, status, errors, toast }`).
  Um 422 com erro por campo vai para o formulário; os outros status viram
  toast. Erro inesperado vira 500 com mensagem genérica — o detalhe fica no log
  da função, nunca no navegador.
- **`redirect()` e `notFound()` passam direto** (`unstable_rethrow`): são
  controle de fluxo do Next, não erro.
- **Um 404 também chama `refresh()`**: o alvo sumiu (outra aba, outro membro), e
  a tela atualizada explica isso melhor que o toast sozinho.

| Opção | Quando |
| --- | --- |
| `auth: 'guest'` | Login, cadastro, recuperação de senha. Quem já tem sessão vai para o painel. |
| `auth: 'any'` | Logout. |
| `refresh: false` | Nada na tela muda: leituras sob demanda (`loadArchivedCards`, `loadExportDetails`) e troca de senha. |

Uma action que termina em `redirect()` nunca chega ao `refresh()` — o redirect
lança antes —, então nas actions de autenticação o `refresh: false` é só
documentação.

**Arquivo `'use server'` só exporta funções async e tipos.** O `defineAction`
devolve uma; constante ou helper exportado ali quebra o build. Helper
compartilhado vai para o serviço ou para `src/server/validation.ts`.

**Toda action é um endpoint público.** O compilador troca a função por um id
que qualquer um pode chamar por POST, de fora da interface. Esconder o botão
não protege nada: a autorização mora no serviço (seção 2.4).

### 2.3 O contrato das actions

[`src/server/actions/contract.ts`](src/server/actions/contract.ts) lista cada
action com entrada e saída — é o equivalente aos `routes/*.php`. Toda action
implementada declara:

```ts
export const moveCard = defineAction(/* ... */) satisfies CardActions['moveCard'];
```

`satisfies`, e não anotação de tipo: confere a assinatura sem alargar o tipo
inferido. Tela e implementação não divergem sem o TypeScript reclamar.

Convenção dos campos: ids do alvo em camelCase (`boardId`, `cardId`); os demais
com o MESMO nome que o corpo da requisição tinha no Laravel, em snake_case
(`due_at`, `ordered_ids`, `password_confirmation`). Assim as chaves de erro de
validação são as que as telas já mostram.

### 2.4 Autorização sempre pelo quadro

Card, lista, etiqueta, comentário e checklist não têm policy própria: todos
pertencem a um quadro, e é o papel da pessoa nele que decide.
[`authorizeBoard`](src/server/policies/board.ts) carrega o quadro e lança 404 se
ele não existe, 403 se a pessoa não pode:

```ts
const card = await cardOrFail(cardId);

await authorizeBoard(actor, card.boardId, 'update');
```

Quatro verbos, e só quatro:

- `view` — é membro
- `update` — mexe no conteúdo (qualquer membro)
- `manage` — configurações, etiquetas e membros (owner/admin)
- `delete` — só o dono (`boards.owner_id`)

Quando um id chega cru do cliente (`labelId`, `userId`, `board_list_id`),
**confira que ele pertence ao MESMO quadro** antes de usar:

```ts
// src/server/services/cards.ts — toggleCardLabel
const [label] = await db
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.id, labelId), eq(labels.boardId, card.boardId)))
    .limit(1);

abortUnless(label, 404);
```

Sem essa consulta, qualquer membro conseguiria colar no card uma etiqueta de
outro quadro. O mesmo vale em `moveCard` (lista de outro quadro → 422 em
`board_list_id`) e no deep link (card de outro quadro → 404). O teste
`test_labels_are_toggled_and_scoped_to_the_board`, em
[`tests/parity/cards.test.ts`](tests/parity/cards.test.ts), existe exatamente
para travar isso.

### 2.5 Validação com a semântica do Laravel

[`src/server/validation.ts`](src/server/validation.ts) replica o que o frontend
já conhecia:

- toda string chega aparada e a vazia vira `null` (o par TrimStrings +
  ConvertEmptyStringsToNull): "  " num campo obrigatório é vazio;
- `max` conta caracteres, não bytes nem unidades UTF-16;
- campo "sometimes" é `.optional()`: ausente não é validado nem gravado — é o
  que deixa `updateCard({ cardId, title })` mexer só no título;
- e-mail sempre em minúsculas e `id()` com o teto do `integer` (seção 6.4);
- mensagens em português; os erros saem como `{ campo: 'mensagem' }`, a
  primeira de cada campo.

Use os helpers (`requiredString`, `nullableString`, `email`, `oneOf`, `id`,
`nullableDateTime`…) em vez de `z.string()` cru: um `z.string().max(500)`
esqueceria de aparar e contaria unidades UTF-16.

**`z.object` é o `#[Fillable]` daqui.** Chave que não está no schema é
descartada. `user_id`, `board_id`, `created_by` e `position` nunca vêm do
pedido: o serviço os preenche com o ator e com o que leu do banco.

### 2.6 Resources como contrato

Nada de mandar a linha do banco para a tela: ela levaria o hash da senha e
colunas internas, e mudaria de formato a cada migration. Cada função de
[`src/server/resources`](src/server/resources) devolve EXATAMENTE um tipo de
[`src/types/index.ts`](src/types/index.ts):

| Resource | Tipo |
| --- | --- |
| `boardResource` | `Board` |
| `cardResource` | `Card` (versão leve, para o Kanban) |
| `cardDetailResource` | `CardDetail` (versão completa, para o modal) |
| `userResource` / `authUserResource` | `User` / `AuthUser` |

Os campos continuam em snake_case, como o JSON do Laravel — o frontend inteiro
foi escrito contra esse formato. Datas saem com `toAppIso` (seção 7.2).

**Ao adicionar um campo:** mude o tipo e o resource no mesmo commit. Como o
resource declara o tipo de retorno, o `npm run types` acusa os dois
esquecimentos — campo faltando ou sobrando.

### 2.7 Consultas: nunca deixe o N+1 nascer

O quadro inteiro sai de um número FIXO de consultas, não importa quantos cards
ele tenha ([`loadBoardPage`](src/server/queries/board.ts)). Listas, cards,
etiquetas, membros e os vínculos card↔etiqueta e card↔pessoa vêm em lote; os
contadores de cada card são subconsultas correlacionadas da própria consulta
dos cards — o `withCount` do Eloquent:

```ts
commentsCount: db.$count(comments, eq(comments.cardId, cards.id)),
checklistDone: db.$count(
    checklistItemsWithCard,
    and(eq(checklists.cardId, cards.id), eq(checklistItems.isDone, true)),
),
```

Detalhes que importam:

- Etiquetas e responsáveis vão no card só como ids (`label_ids`, `member_ids`):
  os objetos completos já estão em `board.labels` e `board.members`. Evita
  repetir a mesma etiqueta 40 vezes no payload.
- `cards.board_id` é **desnormalizado de propósito**: autorização e filtros por
  quadro não precisam de join com `board_lists`.
- Consultas independentes saem juntas, num `Promise.all`: na Vercel cada ida ao
  banco é uma viagem de rede, e em fila elas se somariam na primeira pintura. O
  painel faz o mesmo ([`dashboard.ts`](src/server/queries/dashboard.ts)).
- `db.query.x.findFirst({ with })` serve para árvores pequenas (o card aberto);
  para contagem, subconsulta ou `count()` com `groupBy`.

### 2.8 Ordenação: o cliente manda a ordem final

Reordenar por "índice + 1" gera corrida e drift. Depois de um arraste, o
cliente envia a lista completa de ids na ordem final, e o servidor materializa.
Repetir o pedido dá o mesmo resultado.

```ts
// src/server/services/cards.ts — moveCard
await tx
    .update(cards)
    .set({ position: sql`case ${cards.id} ${positions} else ${cards.position} end` })
    .where(and(eq(cards.boardListId, toList.id), inArray(cards.id, [...order.keys()])));
```

- **Um UPDATE só**, com `CASE`, por mais ids que venham — não um por card.
- O `WHERE` pela lista é a interseção com quem realmente está lá: ids forjados
  (de outra lista, de outro quadro, inexistentes) são ignorados em silêncio.
- Id repetido vale pela última aparição (um `Map` colapsa antes de ir ao banco),
  e o pedido tem teto de 1000 ids (seção 8).
- A lista de destino tem de ser do mesmo quadro; senão, 422 em `board_list_id`.

`reorderLists`, em [`services/lists.ts`](src/server/services/lists.ts), segue o
mesmo desenho. A coluna `position` é `double precision` para permitir migrar um
dia para posicionamento fracionário (média entre vizinhos) sem mudar o schema,
se a concorrência justificar. Hoje a ordem é reescrita inteira a cada arraste.

### 2.9 Transações onde a operação é composta

Criar um quadro cria quadro + membro + 4 etiquetas + 3 listas. Ou tudo, ou
nada:

```ts
return db.transaction(async (tx) => {
    // ...
});
```

O mesmo vale para `registerUser` (conta + quadro de exemplo), `moveCard`,
`updateList` (marcar a coluna como de conclusão conclui quem já está nela), a
varredura dos concluídos e o seed.

Helper chamado dentro de uma transação recebe o `Executor` (`db` ou `tx`) como
último parâmetro — [`logActivity`](src/server/services/activity.ts),
`authorizeBoard`, `cardOrFail`. Esqueça de repassar o `tx` e a gravação vai por
fora da transação: sobrevive ao rollback.

### 2.10 Configuração em `src/server/config.ts`, nunca solta

Fundos, cores, prazos de arquivamento, horário do resumo e limites vivem em
[`src/server/config.ts`](src/server/config.ts) e são usados tanto na validação
(`oneOf(BACKGROUNDS)`, `oneOf(COLORS)`) quanto entregues à tela (`loadBoardPage`
devolve `backgrounds`, `colors` e `autoArchive`). **Uma fonte da verdade**: a
tela não oferece um prazo que o backend recusa, nem promete um horário que o
cron não tem.

As listas são `as const satisfies readonly BoardBackground[]`: a lista do
servidor e o tipo de `src/types` não divergem sem o TypeScript reclamar. O
visual de cada chave mora no cliente — `.board-bg-*` no
[`globals.css`](src/app/globals.css) e o mapa de classes em
[`palette.ts`](src/lib/palette.ts) (seção 4.1).

Variável de ambiente nova entra em `config` com padrão e saneamento (veja como
`clock()` trata um `DIGEST_AT` malformado), não espalhada em `process.env`.

### 2.11 Avisos: toast no resultado, flash só no redirect

Action que fica na mesma tela devolve o aviso no próprio resultado:

```ts
return ok(drawer, toast('success', `"${card.title}" voltou para ${card.listTitle}.`));
```

Action que termina em `redirect()` não devolve valor ao cliente. O aviso viaja
num cookie de vida curta ([`src/server/flash.ts`](src/server/flash.ts)) que o
[`FlashToaster`](src/components/flash-toaster.tsx) lê, mostra e apaga na tela de
destino:

```ts
await flash(toast('success', `"${card.title}" foi excluído.`));

redirect(`/boards/${card.boardId}`);
```

O cookie vive um minuto e é apagado assim que mostrado, então o aviso não volta
quando a pessoa navega para trás — o que o `Inertia::flash` resolvia.
`flashStatus()` é a variante para a caixa de status fixa da tela de login (a
confirmação da senha redefinida); `flashedStatus()` a relê no servidor com teto
de tamanho, porque o cookie é gravável pelo navegador.

**Redirect explícito, nunca "voltar".** Excluir ou arquivar um card manda para
`/boards/{id}` porque a URL anterior era a do próprio card, que agora daria 404
ou reabriria um card que saiu do quadro.

### 2.12 Erros nas páginas — e cada segmento se protege sozinho

O loader lança `HttpError`; a página traduz:

```tsx
// src/app/(app)/boards/[boardId]/layout.tsx
if (error instanceof HttpError && error.status === 404) notFound();
if (error instanceof HttpError && error.status === 403) return <Forbidden />;
```

- **Layout e página rodam em paralelo**, não um depois do outro. O layout do
  quadro autoriza, mas a página do card não pode contar com isso: ela confere
  os ids e chama `loadCardDetail`, que autoriza de novo
  ([`cards/[cardId]/page.tsx`](src/app/(app)/boards/[boardId]/cards/[cardId]/page.tsx)).
- **Id da URL passa por [`parseRouteId`](src/lib/route-id.ts)**: "abc", "1e3" ou
  um número acima do teto do `integer` viram 404 sem nem consultar o banco.
- **`generateMetadata` não vaza o título** de um quadro alheio: sem acesso, a
  aba fica com o título padrão.
- O 403 hoje é uma tela renderizada com status HTTP 200 — ver a seção 17.

---

## 3. Frontend

### 3.1 Tipos são o contrato, não decoração

Todo prop de página é tipado com os DTOs de
[`src/types/index.ts`](src/types/index.ts), os mesmos que os resources devolvem.
`ActionResult<T>` é o que toda action responde. `useCurrentUser()`/`useUser()`,
de [`providers.tsx`](src/components/providers.tsx), substituem o
`usePage().props.auth.user`.

Client Component importa de `src/server` **só** as actions
(`@/server/actions/*`) e `import type`. Os módulos de `src/server` que tocam
banco, cookie ou segredo começam com `import 'server-only'`: importá-los de um
Client Component quebra o build, em vez de levar código — e segredo — para o
navegador. (O `schema.ts` fica sem, porque o drizzle-kit o lê fora do Next.)

Rode `npm run types` antes de commitar. É rápido e pega quase todo desencontro
entre servidor e tela.

### 3.2 Estado do servidor mora no servidor

A regra padrão é: **não copie props para o `useState`**. Renderize direto das
props e deixe o `refresh()` da action trazer a árvore nova.

A única exceção é o arraste, em [`board-show.tsx`](src/components/board/board-show.tsx):
durante o gesto a UI precisa responder no mesmo frame, então existe um espelho
local que volta a ser sobrescrito pelo servidor assim que a resposta chega.

```tsx
const [lists, setLists] = useState<BoardList[]>(board.lists);

useEffect(() => {
    serverLists.current = board.lists;

    if (isDragging.current) missedSync.current = true;   // entra quando o gesto acabar
    else setLists(board.lists);                          // o servidor manda de novo
}, [board.lists]);
```

O `isDragging` evita que uma resposta chegando no meio do gesto puxe o card de
volta da mão de quem arrasta; o `missedSync` lembra de aplicá-la quando o gesto
termina. Se o servidor recusar a gravação, o espelho volta ao que ele mandou por
último (`resync`): a tela nunca fica mostrando uma ordem que não foi salva.

Fora do servidor só mora o que não tem contrapartida no banco e é do
navegador, não da conta: o tema (cookie + `localStorage`, seção 7.5), as opções
da exportação e o pomodoro ([`src/lib/pomodoro.ts`](src/lib/pomodoro.ts), um
store de módulo porque cada página monta o próprio `AppLayout`). Não existe
store global de dados — o servidor é o store.

### 3.3 Mutação com `runAction`, e a página já volta atualizada

Toda chamada de action no cliente passa por [`runAction`](src/lib/actions.ts):

```tsx
void runAction(() => updateList({ listId: list.id, is_done: !list.is_done }));
```

Ele mostra o toast que o servidor mandou, manda para o login no 401 (com
`?next=`), transforma queda de rede ou deploy novo em "não salvou" — nunca em
silêncio — e liga a barra de progresso (seção 3.8). Prefira passar uma função:
o aviso de começo sai antes de a action ser despachada. A página **não** precisa
ser recarregada: ela chega re-renderizada na mesma resposta.

Regras que caem junto:

- **`redirect()` rejeita a Promise.** No Next 16, a action que termina em
  `redirect()` não resolve: o cliente recebe o erro de controle `NEXT_REDIRECT`
  enquanto já navega. O `runAction` o reconhece pelo `digest` e devolve `null` —
  sem isso, todo login, criar quadro ou excluir card mostrava um falso "Sem
  conexão com o servidor" por cima do aviso de sucesso.
- **As actions são despachadas uma de cada vez**, em fila, pelo próprio Next.
  Não use `Promise.all` com actions: elas não andam juntas, e a ordem já é
  garantida. É isso que deixa o compositor de cards
  ([`useComposer`](src/components/board/add-card.tsx)) liberar o campo na hora:
  cada Enter leva o próprio título, e os envios chegam na ordem.
- **Action lenta segura a fila da aba.** Trabalho demorado que a tela não
  precisa esperar (mandar e-mail para muita gente, por exemplo) não cabe dentro
  da action: vai para `after()` ou para um cron.
- **Não duplique o toast.** O que o servidor mandou o `runAction` já mostrou. No
  `onError`, mostre só o que veio sem toast — o 422 de um arraste, que não tem
  campo onde aparecer.

### 3.4 Deep link em vez de estado de modal

O card aberto é uma rota (`/boards/1/cards/42`), não um `useState`.
Consequências de graça: F5 reabre o card, Voltar fecha, o link é
compartilhável.

O truque está em onde cada metade mora:

- O quadro fica no [`layout.tsx`](src/app/(app)/boards/[boardId]/layout.tsx) de
  `/boards/[boardId]`. O App Router **não remonta layouts** ao navegar entre
  `/boards/1` e `/boards/1/cards/42`, então filtros, seleção e scroll
  sobrevivem — era o `preserveState` do Inertia.
- A página do card só carrega o `CardDetail` e o entrega ao quadro pela ponte de
  [`active-card.tsx`](src/components/board/active-card.tsx), que publica o card
  num effect e o retira ao desmontar.
- O `CardModal` fica sempre montado no `BoardShow`: quando a ponte devolve
  `null`, o `AnimatePresence` anima a saída.

```tsx
const openCard = (card: Card) => {
    const href = `/boards/${board.id}/cards/${card.id}`;

    startNavigationProgress(href);
    router.push(href, { scroll: false });   // o preserveScroll do Inertia
};
```

Toda action chamada com o modal aberto re-renderiza layout e página na mesma
resposta: o card aberto nunca fica desatualizado.

### 3.5 Formulários com `useActionForm`

[`useActionForm`](src/lib/actions.ts) é o `useForm` do Inertia apontado para uma
Server Action: guarda os campos, envia, recebe os erros por campo (422) e
expõe `processing` e `recentlySuccessful` (o "Salvo!" de 2 s). Nunca monte
`fetch` na mão nem trate erro de validação manualmente:

```tsx
const form = useActionForm({ email: '', password: '', remember: false, next }, login);

form.submit({ onFinish: () => form.reset('password') });
```

Os nomes dos campos são os do contrato (seção 2.3), então
`form.errors.password_confirmation` é exatamente o que o servidor devolve. Erro
de validação do objeto inteiro, sem campo, chega em `errors.form`.

### 3.6 Componentes: primitivo não conhece domínio

`components/ui/*` não importa nada que saiba o que é quadro, lista ou card (o
`Avatar` conhece uma pessoa, e só). Se um botão precisar saber o que é um card,
ele não pertence a `ui/`.

Componentes de domínio recebem dados por prop e disparam mutações por
`runAction`.

### 3.7 Carregar depois: Promise + `use()` + `Suspense`

O que era `Inertia::defer` virou uma Promise passada SEM `await` do Server
Component para o Client Component, que a lê com `use()` dentro de um
`<Suspense>`: o HTML chega primeiro, o pedaço lento chega depois, no mesmo
stream.

```tsx
// src/app/(app)/boards/[boardId]/layout.tsx — depois da autorização
const activity = loadBoardActivity(user, id);   // sem await

return <BoardShow board={data.board} activity={activity} /* ... */ />;
```

- **Comece a Promise só depois de autorizar.** Ela roda mesmo que ninguém a
  leia; criada antes, rodaria para quem não pode ver o quadro.
- **Dê à falha um lugar para cair.** Sem tratamento, a rejeição relançada pelo
  `use()` sobe até o `error.tsx` e derruba a tela inteira por causa de um
  pedaço acessório. O painel resolve no servidor, com `.catch(() => null)` em
  [`dashboard/page.tsx`](src/app/(app)/dashboard/page.tsx); o quadro, com uma
  error boundary local em [`activity-panel.tsx`](src/components/board/activity-panel.tsx),
  que ganha uma segunda chance a cada `refresh()` (cada re-renderização traz
  uma Promise nova).

O que era `Inertia::optional` — dado pesado que só alguns abrem — virou **action
de leitura** com `refresh: false`, chamada pelo cliente quando precisa: os
detalhes da exportação (`loadExportDetails`, uma vez por visita) e a gaveta de
arquivados (`loadArchivedCards`, a cada abertura). Nunca carregue isso no
layout: seria uma consulta pesada em toda visita ao quadro.

### 3.8 A barra de progresso

No App Router a navegação espera o servidor sem nenhum sinal na tela: clicar
num quadro parecia não ter feito nada.
[`navigation-progress.tsx`](src/components/navigation-progress.tsx) devolve a
barrinha que o Inertia mostrava:

- liga em clique de link interno (escutado na fase de captura, antes de o
  `<Link>` cancelar o evento), em Voltar/Avançar e em
  `startNavigationProgress(href)` — chame-o antes de todo `router.push`;
- liga também enquanto houver action pendente: o `runAction` avisa começo e
  fim, sempre aos pares (o fim sai no `finally`, inclusive no redirect);
- só aparece depois de 120 ms, então navegação ou action rápida não pisca barra
  nenhuma, e desiste sozinha em 10 s;
- a origem da navegação é o pathname **commitado**, não o `window.location`: no
  Voltar o navegador troca a URL antes do `popstate`, e a barra ficava presa;
- anima só `transform` (seção 4.2).

O arraste passa `progress: false` (o antigo `showProgress: false`): o card já
está onde a pessoa soltou, e uma barra correndo sugeriria que não.

A lógica é um reducer puro, testado em
[`tests/regressions/navigation.test.ts`](tests/regressions/navigation.test.ts).

### 3.9 Performance

- **Code splitting por rota é automático**: a tela de login não baixa o dnd-kit,
  que só entra pelo `BoardShow`.
- **Prefetch.** Em produção, o `<Link>` pré-carrega a rota quando ela aparece
  na tela — inteira se for estática; se for dinâmica, só quando há um
  `loading.tsx` no caminho, e só até ele. **Não crie `loading.tsx` em
  `/boards/[boardId]` nem abaixo**: o layout do quadro grava
  `board_user.last_opened_at`, e o prefetch o executaria — a ordem "abertos por
  último" de `/boards` mudaria só porque o link apareceu na tela. O painel pode
  ter o seu ([`dashboard/loading.tsx`](src/app/(app)/dashboard/loading.tsx)): o
  que o prefetch roda ali é só o layout raiz.
- **`useMemo` só onde há custo real** — a filtragem de cards no `BoardShow`
  roda a cada render do arraste. Em botão, não use.
- **Dependência pesada fica fora do caminho.** O PGlite (~25 MB com o WASM) está
  em `serverExternalPackages` e fora do pacote da função
  ([`next.config.ts`](next.config.ts)); `nodemailer` e `resend` entram por
  `import()` só quando o mailer correspondente é usado.

---

## 4. Interface, animação e acessibilidade

### 4.1 Tokens, não cores soltas

Toda cor vem de uma variável CSS em [`src/app/globals.css`](src/app/globals.css)
e é exposta como utilitário do Tailwind v4 via `@theme inline`:

```css
:root  { --surface: oklch(100% 0 0); }
.dark  { --surface: oklch(21.5% 0.022 267); }

@theme inline { --color-surface: var(--surface); }
```

Use `bg-surface`, `text-muted-fg`, `ring-border`. **Não** use `bg-white
dark:bg-slate-800` espalhado — trocar o tema viraria caça ao tesouro.

Exceção consciente: cores de etiqueta e capa são um mapa estático em
[`palette.ts`](src/lib/palette.ts), porque o Tailwind só gera a classe que
enxerga escrita por extenso. `` `bg-${color}-500` `` **não funciona**. Os
gradientes dos quadros são classes `.board-bg-*` no `globals.css` pelo mesmo
motivo.

### 4.2 Anime transform e opacity. Só.

`transform` e `opacity` rodam na GPU sem recalcular layout. Animar `width`,
`top` ou `height` força reflow a 60 fps e o quadro engasga. Até a barra de
progresso do topo cresce por `scaleX`.

Exceções onde vale a pena, todas em elementos pequenos e isolados: as barras de
progresso da checklist ([`card-modal.tsx`](src/components/board/card-modal.tsx))
e do "Progresso por quadro" ([`board-progress.tsx`](src/components/dashboard/board-progress.tsx))
animam `width` com `motion`, e a entrada de um item de checklist anima `height`.
Fora disso, `scaleY` + `opacity` no lugar de `height: auto` — o painel de ajuste
do [`pomodoro-widget.tsx`](src/components/pomodoro-widget.tsx) é o exemplo.

### 4.3 Feedback de clique

Todo botão em [`button.tsx`](src/components/ui/button.tsx) tem duas camadas de
resposta tátil:

1. `active:scale-[0.97]` — a "afundada", em CSS puro, custo zero.
2. Ripple nascendo na coordenada exata do ponteiro
   ([`use-ripple.tsx`](src/hooks/use-ripple.tsx)), limpo no `onAnimationEnd` —
   sem `setTimeout` pendurado.

### 4.4 `prefers-reduced-motion` não é opcional

Um bloco global no `globals.css` zera as durações de transição e animação CSS, e
o `useRipple`/`useReveal` checam a media query antes de agendar qualquer coisa.
O que o `motion` anima por JS o bloco não alcança — ver a seção 12.6. Movimento
é enfeite; para parte dos usuários é enjoo.

### 4.5 Revelação no scroll com IntersectionObserver

Nunca com `addEventListener('scroll')` + `getBoundingClientRect()`: isso força
layout a cada frame. O hook [`use-reveal.ts`](src/hooks/use-reveal.ts) observa
uma vez e desconecta o alvo assim que ele aparece.

Parallax é a exceção legítima: o `useScroll` do `motion` (na tela de boas-vindas)
usa scroll timeline e `transform`, sem tocar em layout.

### 4.6 Acessibilidade mínima obrigatória

- Todo botão só de ícone tem `aria-label`.
- Campo de formulário vai dentro de `<Field>` ([`input.tsx`](src/components/ui/input.tsx)):
  o `<label>` aponta para o campo (`htmlFor` + `useId`), e erro e dica chegam
  por `aria-describedby`/`aria-invalid`.
- Modais ([`modal.tsx`](src/components/ui/modal.tsx)): `role="dialog"`,
  `aria-modal`, fecham no `Esc`, travam o scroll do fundo sem "pular" o layout
  (compensam a largura da barra de rolagem). Só o modal do topo da pilha
  responde ao `Esc` — a confirmação aberta sobre o card fecha sozinha —, e um
  `Esc` já usado por um campo ou popover (`defaultPrevented`) não fecha o modal
  junto.
- Drag and drop tem `KeyboardSensor`: Tab até o card, Espaço pega, setas movem,
  Espaço solta — e o leitor de tela narra em português (seção 5).
- Nada de `window.confirm()` para ações destrutivas — ele trava a thread e
  quebra a continuidade visual. Use [`useConfirm`](src/components/ui/confirm.tsx).
- `:focus-visible` sempre visível; não remova outline sem colocar outro.

---

## 5. Drag and drop

Escolha: **@dnd-kit**, não `react-beautiful-dnd` (sem manutenção e incompatível
com React 19). O código está em [`board-show.tsx`](src/components/board/board-show.tsx),
[`list-column.tsx`](src/components/board/list-column.tsx) e
[`card-item.tsx`](src/components/board/card-item.tsx).

Três coisas resolvem 90% dos problemas de um Kanban:

**1. Colisão filtrada por tipo.** Colunas e cards vivem no mesmo `DndContext`.
Sem filtrar, um card "gruda" na coluna e vice-versa:

```tsx
const collisionDetection = useCallback<CollisionDetection>((args) => {
    const type = args.active.data.current?.type;

    return closestCorners({
        ...args,
        droppableContainers: args.droppableContainers.filter((container) =>
            type === 'list'
                ? container.data.current?.type === 'list'
                : container.data.current?.type !== 'list',
        ),
    });
}, []);
```

**2. Zona de soltura própria por coluna.** O `useSortable` da coluna não cobre o
corpo vazio. Um `useDroppable` com id `dropzone:{id}` é o que permite largar um
card numa lista sem nenhum card.

**3. Movimento entre colunas no `onDragOver`, não no `onDragEnd`.** Assim o card
já aparece na coluna de destino enquanto o dedo ainda está pressionado.

Cuidados menores que dão trabalho quando faltam:

- Distinguir clique de arraste: `activationConstraint: { distance: 6 }` no
  mouse, e no `onClick` do card uma checagem de quanto o ponteiro andou.
- Ao espalhar `{...listeners}`, **encadeie** seu `onPointerDown`/`onKeyDown` em
  vez de sobrescrever — o spread vem antes, o seu handler depois, e o do dnd-kit
  some. No card, Enter abre e Espaço fica com o arraste por teclado.
- No toque, `activationConstraint: { delay: 200, tolerance: 8 }` +
  `touch-manipulation`: segurar arrasta, deslizar rola a coluna.
- `DndContext` com `id={useId()}`: o dnd-kit numera o `aria-describedby` com um
  contador de módulo, que anda diferente no SSR e no navegador — sem id fixo,
  erro de hidratação.
- Os avisos do leitor de tela falam português e dizem o título do card ou da
  lista (`ANNOUNCEMENTS`); o padrão do dnd-kit diria "Picked up draggable item
  card:42".
- Soltou fora de tudo, ou o servidor recusou? O espelho volta ao que o servidor
  mandou (seção 3.2). Soltou onde estava? Nada é gravado — a `signature` da
  ordem antes e depois é a mesma.

---

## 6. Banco: Drizzle + Postgres

### 6.1 Dois motores, a mesma API

[`src/server/db/index.ts`](src/server/db/index.ts):

- **`DATABASE_URL` definida** → Postgres de verdade via `pg` (Neon, Supabase, um
  Postgres local). Use a URL do **pooler** (Neon: a "pooled"; Supabase: o
  Supavisor em modo transaction, porta 6543): cada instância de função abre o
  próprio pool (`DATABASE_POOL_MAX`, padrão 5), e sem pooler as conexões do
  Postgres se esgotam no primeiro pico. Na Vercel o pool é entregue ao
  `attachDatabasePool` (`@vercel/functions`), que fecha as conexões ociosas
  antes de a instância congelar.
- **Sem `DATABASE_URL`** → PGlite, um Postgres compilado para WebAssembly, em
  `.data/pglite`. Nada para instalar no desenvolvimento; nos testes, em memória.
- **Na Vercel, sem URL é erro**, não fallback: um PGlite dentro da função seria
  um banco descartável que some a cada deploy, em silêncio.

Serviço nenhum sabe qual motor está do outro lado: o `Database` é tipado como o
`PgDatabase` genérico do Drizzle.

O PGlite é de **um processo só**: dois processos abrindo o mesmo diretório
corrompem o banco. Pare o `npm run dev` antes de rodar `db:fresh`, `db:seed` ou
`db:migrate` no banco local.

### 6.2 A conexão nasce na primeira consulta

O `db` exportado é um `Proxy`: o pool (ou o PGlite) só é criado quando alguém
consulta, não quando o módulo é importado. O motivo é o build: o `next build`
importa os módulos de servidor em vários workers ao mesmo tempo, e, aberto já
no import, o PGlite local seria aberto por todos eles no mesmo diretório — o
WASM aborta e o banco de desenvolvimento pode corromper. Na Vercel, o pool
também só existe depois que alguém precisa dele.

No desenvolvimento a instância fica em `globalThis`: o Next reavalia módulos a
cada edição, e cada reload abriria outro pool (ou um segundo PGlite no mesmo
diretório). Nos testes é o contrário — cada arquivo ganha a sua.

Os scripts começam com `import './_bootstrap'` (carrega o `.env` como o Next) e
rodam com `tsx --conditions=react-server`, para o `import 'server-only'` não
lançar fora do Next ([`scripts/_bootstrap.ts`](scripts/_bootstrap.ts)).

### 6.3 Migrations

O schema mora em [`src/server/db/schema.ts`](src/server/db/schema.ts): camelCase
no TypeScript, snake_case no banco, com os mesmos nomes de tabela e coluna do
Laravel. O fluxo:

1. mude o `schema.ts`;
2. `npm run db:generate` — o drizzle-kit escreve o SQL em [`drizzle/`](drizzle)
   e atualiza o snapshot e o `_journal.json` em `drizzle/meta`;
3. **leia o SQL gerado** antes de commitar. O drizzle-kit pergunta se uma coluna
   que sumiu foi renomeada; responder errado vira drop + add, com perda de
   dado;
4. commite schema, SQL, snapshot e journal juntos;
5. `npm run db:migrate` aplica — localmente à mão, na Vercel sozinho no build
   (seção 11.4).

Nunca edite uma migration que já rodou em algum banco, e nunca use
`drizzle-kit push` contra produção: o histórico de `drizzle/` é o que garante
que todo banco chega ao mesmo lugar.

O [`migrate`](scripts/migrate.ts) usa a conexão **direta** quando ela existe
(`DATABASE_URL_UNPOOLED`, que a integração do Neon injeta, ou `DIRECT_URL` no
Supabase, porta 5432): o pooler em modo transaction serve para o app, não para
DDL.

### 6.4 Armadilhas da troca MySQL → Postgres

Cada uma já mordeu uma vez:

- **`ORDER BY ... DESC` põe NULL primeiro** no Postgres; o MySQL punha por
  último. A lista de quadros ordena por "aberto por último" com
  `` sql`${boardUser.lastOpenedAt} desc nulls last` ``
  ([`boards-index.ts`](src/server/queries/boards-index.ts)). Coluna anulável em
  `desc`? Escreva o `nulls last`.
- **`count(*)` volta como string no `pg`** (é `bigint`). Use `count()` ou
  `db.$count()` do Drizzle, que convertem; SQL cru numérico leva
  `.mapWith(Number)`. Sem isso, `"3" + 1` vira `"31"` na tela.
- **Comparação de texto diferencia maiúsculas.** O MySQL não diferenciava. O
  e-mail é normalizado para minúsculas na entrada (`email()` em
  `validation.ts`) e gravado assim; compare sempre com o valor normalizado —
  inclusive em filtro de linha de comando (`--user=Ana@...`).
- **A ordem alfabética é a da collation do banco** — no PGlite, a "C", byte a
  byte: "Zeta" antes de "alfa", e "Ágil" depois de "Zeta". Onde a ordem dos
  títulos aparece na tela, ela é decidida no Node com
  `Intl.Collator('pt-BR', { sensitivity: 'base' })`, como o desempate do
  progresso dos quadros em [`dashboard.ts`](src/server/queries/dashboard.ts) —
  que só corta os seis primeiros depois de ordenar.
- **Chave estrangeira não ganha índice sozinha.** O InnoDB criava um para cada
  FK; o Postgres não, e sem ele apagar o registro pai (o `ON DELETE CASCADE` ou
  `SET NULL`) varre a tabela filha inteira. Toda FK precisa começar algum
  índice — um composto que já comece pela coluna basta. A migration
  [`0001_fk_indexes.sql`](drizzle/0001_fk_indexes.sql) cobriu as quatro que
  faltavam, e [`tests/regressions/limits.test.ts`](tests/regressions/limits.test.ts)
  falha se uma FK nova nascer sem índice.
- **`integer` tem teto (2³¹ − 1).** Um id maior que isso não é "não encontrado"
  para o Postgres, é erro ("value out of range for type integer") — 500 no
  lugar de 404 ou 422. Ids do cliente passam por `id()` (`.max(MAX_ID)`, em
  `validation.ts`) e ids da URL por [`parseRouteId`](src/lib/route-id.ts). O
  `MAX_ROUTE_ID` de lá repete o valor de propósito: `src/lib` vai para o
  navegador e não importa código de servidor.
- **Violação de unicidade é o código `23505`** (não o 1062 do MySQL), e o
  Drizzle embrulha o erro do driver em `cause`. Use `isUniqueViolation`, de
  [`services/auth.ts`](src/server/services/auth.ts), que desce pela cadeia.
- **`GROUP BY` de expressão com parâmetro.** O Postgres não reconhece duas
  expressões com parâmetros diferentes como iguais, então o agrupamento por dia
  (`to_char((col at time zone $1)::date, ...)`) usa `` groupBy(sql`1`) ``, pela
  posição.
- **`timestamptz` sempre.** O instante é guardado sem ambiguidade, e o fuso do
  app só entra na hora de decidir "hoje" ou formatar (seção 7).

### 6.5 Timestamps pelo relógio da aplicação

`created_at` e `updated_at` são preenchidos por `$defaultFn(() => new Date())`
(e `$onUpdate` no `updated_at`), não pelo `now()` do banco — era o que o
Eloquent fazia. É isso que deixa os testes congelarem o tempo com
`vi.setSystemTime` (o `Carbon::setTestNow`): o `now()` do Postgres não obedece a
um relógio falso. O `DEFAULT now()` continua no banco para inserts feitos fora
do Drizzle.

O `$onUpdate` só roda em `db.update()` do Drizzle: SQL cru não toca o
`updated_at`.

---

## 7. Fuso horário e hidratação

### 7.1 O servidor roda em UTC; o fuso do app é explícito

No Laravel o PHP fazia tudo em `config('app.timezone')`. Aqui há dois relógios:
o servidor da Vercel roda em **UTC**, e o navegador no fuso de quem abre. Se os
dois decidirem "hoje" em fusos diferentes, o selo vermelho do card contradiz o
número do painel — e o HTML do SSR não bate com a hidratação.

Por isso existe um fuso do APP, o mesmo dos dois lados da rede: `APP_TIMEZONE`
(padrão `America/Sao_Paulo`). O [`next.config.ts`](next.config.ts) o copia para
`NEXT_PUBLIC_APP_TIMEZONE`, que o Next embute no código — do navegador e do
servidor — **no build**: trocar o fuso exige um deploy novo, não só mudar a
variável. Scripts e testes, que não passam pelo build, leem `APP_TIMEZONE`
direto ([`src/lib/timezone.ts`](src/lib/timezone.ts)).

O Vitest roda com `TZ: 'UTC'` ([`vitest.config.ts`](vitest.config.ts))
justamente para o processo se comportar como a função da Vercel: código que
esquece o fuso falha no teste, não em produção.

### 7.2 Toda data é cortada e formatada no fuso do app

Tudo passa por [`src/lib/timezone.ts`](src/lib/timezone.ts) e pelos formatadores
de [`src/lib/utils.ts`](src/lib/utils.ts):

| Para | Use | Não use |
| --- | --- | --- |
| que dia é | `dayKey(date)` | `toISOString().slice(0, 10)` (o dia em UTC) |
| início e fim de hoje | `startOfAppDay`, `endOfAppDay` | `setHours(0, 0, 0, 0)` (o fuso do processo) |
| N dias depois | `addAppDays` (dias de calendário) | `+ n * 86_400_000` (erra na troca de horário de verão) |
| hora de parede | `wallClock(date)` | `getHours()`, `getDate()` |
| data para o cliente | `toAppIso(date)` — ISO com o offset do fuso do app, o `toIso8601String()` do Carbon | `toISOString()` (o contrato da tela é o formato do Carbon) |
| formatar na tela | `formatDate`, `formatDateTime`, `formatRelative` | `toLocaleDateString()` sem `timeZone` |
| agrupar por dia no SQL | `(${col} at time zone ${APP_TIMEZONE})::date` | `date(col)` |

Dois exemplos reais. A saudação do painel usa `wallClock(new Date()).hour`: com
`getHours()`, o SSR na Vercel diria "Boa tarde" às 9 da manhã de São Paulo
([`dashboard.tsx`](src/components/dashboard/dashboard.tsx)). E o gráfico de ritmo
recebe dias soltos ("2026-08-13"), que `new Date()` leria como meia-noite UTC —
21:00 do dia anterior em São Paulo; por isso
[`trend-chart.tsx`](src/components/dashboard/trend-chart.tsx) ancora ao meio-dia
UTC e formata em UTC, o que dá o mesmo texto no servidor e em qualquer
navegador.

### 7.3 O prazo do card

O `<input type="datetime-local">` manda uma data **sem fuso**
(`"2026-08-13T09:00"`). O servidor a lê no fuso do app (`nullableDateTime()` →
`parseAppDateTime`), e a tela a devolve ao campo no mesmo fuso
(`toDateTimeLocal`). Escolher 09:00 grava 12:00Z e mostra 09:00 de volta. (No
Laravel, com `UTC` no config, a tela devolvia 06:00 — três horas a menos, sem
erro nenhum.)

`parseAppDateTime` também recusa data que não existe (`2026-02-31` viraria 3 de
março em silêncio) e, no horário que o relógio pula no início do horário de
verão, fica com o instante depois do pulo, como o Carbon.

Consequência consciente: quem abre o app de outro fuso vê e digita prazos no
fuso do app, não no do computador. Se um dia houver gente em fusos diferentes,
a saída não é voltar para o fuso do navegador — é guardar o fuso **por
usuário** e converter na borda (formulário, tela e e-mail), mantendo o banco em
UTC (seção 17).

### 7.4 Hidratação: o que muda entre o SSR e o navegador

O Inertia renderizava só no navegador; o Next renderiza os Client Components
também no servidor. Tudo que pode sair diferente nas duas passadas quebra a
hidratação:

- **Relógio.** Texto que depende de `Date.now()` ("há 3 horas", a saudação) usa
  [`<TimeAgo>`](src/components/time-ago.tsx) ou fica num elemento com
  `suppressHydrationWarning` — o SSR e a hidratação acontecem em instantes
  diferentes.
- **Preferência do navegador** (`localStorage`, `matchMedia`) nunca é lida
  durante o render. Use `useSyncExternalStore` com um snapshot de servidor fixo:
  [`useAppearance`](src/hooks/use-appearance.ts) responde `'system'`,
  [`usePrefersReducedMotion`](src/hooks/use-prefers-reduced-motion.ts) responde
  `false`, o [`Modal`](src/components/ui/modal.tsx) só abre o portal depois de
  hidratado. Os dois lados concordam, e o cliente corrige logo em seguida.
- **Id gerado** (`Math.random()`, contador de módulo) → `useId()`. É o caso do
  `DndContext` (seção 5).
- **Hook de terceiro que já responde diferente**: o `useReducedMotion()` do
  `motion` dá `null` no SSR e `true` na hidratação para quem pediu menos
  movimento. Por isso o app usa o próprio `usePrefersReducedMotion`.

### 7.5 Tema sem flash

O tema escolhido vai para um cookie `appearance` (e para o `localStorage`). O
layout raiz ([`src/app/layout.tsx`](src/app/layout.tsx)) lê o cookie e injeta um
script inline no `<head>` que põe a classe `dark` no `<html>` **antes do
primeiro paint** — o "Sistema" se resolve ali mesmo, pelo
`prefers-color-scheme`. Um `<style>` inline pinta o fundo do `<html>` para não
piscar branco antes de o CSS chegar.

**O React não renderiza `className` no `<html>`**, de propósito. Cada `refresh()`
de Server Action re-renderiza a raiz; se o `<html>` tivesse `className`, o React
reescreveria o atributo com o valor que o servidor conhece e apagaria o `dark`
que veio do sistema operacional. Era um bug de verdade: tema "Sistema" com o SO
escuro ficava claro depois de qualquer ação. A classe `dark` é só do script
inline e do `apply()` de `use-appearance.ts`; o `suppressHydrationWarning` do
`<html>` cobre a diferença. A variável da fonte (`next/font`) mora no `<body>`
pelo mesmo motivo.

---

## 8. Segurança

- **Sessão própria, sem JWT e sem token no `localStorage`**
  ([`session.ts`](src/server/auth/session.ts)). O cookie `taskon_session` é
  `HttpOnly`, `SameSite=Lax` e `Secure` em produção, e carrega um token
  aleatório de 32 bytes; o banco guarda só o SHA-256 dele — um vazamento da
  tabela `sessions` não entrega sessões prontas.
  - **Rotação no login**: `startSession` apaga a sessão anterior daquele
    navegador e cria outra (o `session()->regenerate()`, contra fixação de
    sessão).
  - **Expiração deslizante**: sem "lembrar de mim", o cookie é de sessão do
    navegador e o servidor expira por inatividade (`SESSION_LIFETIME`, 120 min
    por padrão). Cada uso empurra o prazo, gravando no máximo uma vez por
    minuto para não escrever no banco a cada requisição.
  - **"Lembrar de mim"**: cookie persistente de 400 dias, o teto que os
    navegadores aceitam.
  - **Redefinir a senha derruba todas as sessões** da pessoa: quem pede o link
    pode estar fazendo isso justamente por ter sido invadido. O token do link
    também é guardado como SHA-256, comparado em tempo constante, vale 60 min e
    uma vez só.
- **O proxy é otimista.** [`src/proxy.ts`](src/proxy.ts) só olha se o cookie
  existe — sem banco — e manda o visitante para `/login?next=`. A checagem de
  verdade é o `requireUser()` em cada página e o `defineAction` em cada action.
  O proxy não redireciona POST: Server Action é um POST para a própria página, e
  redirecioná-la quebraria o protocolo (sem sessão, a action responde 401
  sozinha).
- **bcrypt compatível com o `$2y$` do Laravel** ([`password.ts`](src/server/auth/password.ts)):
  uma base importada do sistema antigo continua entrando com a mesma senha.
  `bcryptjs` é JavaScript puro — nada de binário nativo para compilar na Vercel.
  E-mail inexistente ainda gasta o tempo de um bcrypt (`burnPasswordCheck`):
  sem isso, a demora da resposta denunciaria quais contas existem.
- **Rate limit no banco, não na memória** ([`rate-limit.ts`](src/server/auth/rate-limit.ts)).
  Em serverless cada requisição pode cair numa instância diferente: um contador
  em memória seria um por instância, e zeraria a cada cold start. A janela é
  fixa, como a do Laravel.

  | O quê | Limite |
  | --- | --- |
  | Login, por IP | 10 por minuto (o `throttle:10,1`) |
  | Login, por e-mail + IP | 5 erros bloqueiam até a janela fechar; acertar zera |
  | Cadastro, por IP | 10 por minuto |
  | "Esqueci a senha" | 6 por minuto por IP; um link a cada 60 s por e-mail |
  | Convite por e-mail | 20 por hora por pessoa que convida |
  | Link de confirmação de e-mail | um a cada 60 s e 5 por hora, por conta |
  | Troca de senha | 6 por minuto por pessoa |
  | Resumo de teste | 3 por minuto por pessoa |

  As janelas vencidas (e as sessões, os convites e os pedidos de confirmação
  vencidos) são apagadas pelo cron noturno de arquivamento.
- **O `?next=` não vira redirecionamento aberto**
  ([`safeRedirectPath`](src/server/auth/session.ts)). Checar o prefixo ("começa
  com `/` e não com `//`") não basta, porque o navegador limpa a URL antes de
  segui-la: ele APAGA TAB, CR e LF de qualquer ponto (`"/\t/evil.com"` vira
  `//evil.com`, outro domínio) e trata `\` como `/`. Por isso a função recusa
  caractere de controle e barra invertida em qualquer posição, normaliza o
  caminho com o mesmo algoritmo do navegador (o `URL` do WHATWG — `"/a/..//evil.com"`
  também resolve para `//evil.com`) e decide sobre o resultado normalizado, que
  é o que ela devolve. Coberto em
  [`tests/regressions/auth-redirect.test.ts`](tests/regressions/auth-redirect.test.ts).
- **Convite é credencial** ([`invitations.ts`](src/server/services/invitations.ts)).
  O link `/invite/<token>` leva 32 bytes aleatórios; o banco guarda só o SHA-256
  (como sessões e redefinição de senha), o convite vale 7 dias e uma vez só —
  aceitar APAGA a linha antes de inserir a pessoa, então dois cliques não entram
  duas vezes. E o convite **não** é aceito sozinho quando alguém se cadastra com o
  e-mail convidado: o cadastro não verifica e-mail, e qualquer um criaria a conta com
  o endereço de outra pessoa para herdar os quadros dela. Sem o link, não entra.
  Convidar também manda e-mail para um endereço digitado por alguém — daí o teto
  por hora, e o envio dentro da transação: se o e-mail não sai, nenhum convite
  fica pendente (nem o link de um reenvio anterior é invalidado).
- **Admin do Taskon exige prova, e bloqueio vale na hora** (seção 16). O e-mail
  do admin nativo está no código público, então ele só vale com o e-mail
  confirmado (link de confirmação ou redefinição de senha). Bloquear apaga
  todas as sessões da conta, e `currentSession` recusa sessão de conta
  bloqueada mesmo assim. O login só conta que a conta está bloqueada depois da
  senha certa.
- **CSRF**: Server Action só aceita POST, e o Next compara o `Origin` com o
  `Host` (ou `X-Forwarded-Host`), recusando o que não bate. O cookie de sessão
  `SameSite=Lax` também não vai em POST vindo de outro site. Atrás de um proxy
  com outro domínio, configure `serverActions.allowedOrigins` — não desligue a
  checagem.
- **Crons** ([`src/server/cron.ts`](src/server/cron.ts)): a Vercel manda
  `Authorization: Bearer $CRON_SECRET`, e a comparação é em tempo constante
  (`timingSafeEqual`), para o tempo de resposta não ir entregando o segredo.
  Sem `CRON_SECRET`, as rotas só abrem fora de produção: uma URL pública que
  arquiva cards ou dispara e-mail para a base inteira não pode depender de
  ninguém descobri-la.
- **E-mail.** Na Vercel (produção ou preview) o mailer `log` LANÇA em vez de
  escrever: o corpo pode carregar um link de redefinição de senha, que não pode
  parar no log do deploy, e fingir que enviou faria o resumo carimbar todo mundo
  e o "Esqueci a senha" anunciar um link que nunca saiu. Configure o Resend. O nome do
  destinatário passa por [`formatAddress`](src/server/mail/mailer.ts): quebra de
  linha vira espaço (contra injeção de cabeçalho), e nome com vírgula, `<` ou
  acento vai entre aspas — senão "Ana <outro@dominio.com>" desviaria o e-mail.
- **Limites de tamanho.** `ordered_ids` aceita até 1000 ids: nenhuma coluna de
  verdade chega perto, e um pedido forjado com milhares de ids (repetidos, até)
  custaria ao banco a cada envio. Todo texto tem `max` na action, todo id tem o
  teto do `integer`, e o corpo de uma Server Action é limitado a 1 MB pelo Next.
- **O seed recusa produção.** `db:seed` e `db:fresh` param quando
  `NODE_ENV=production` ou `VERCEL` está definido, a menos que venha `--force`:
  as contas de demonstração têm senha pública, e o `vercel env pull` traz
  `VERCEL=1` para o `.env.local` junto com a URL do banco de produção
  ([`scripts/seed.ts`](scripts/seed.ts)).
- **Cookies legíveis pelo JS** são só `appearance`, `taskon_flash` e
  `taskon_status`. Nenhum carrega nada sensível, e o conteúdo do flash é
  mostrado como texto, nunca como HTML.
- **Nunca confie em esconder o botão.** `board.can.manage` e `board.can.delete`
  servem à tela; quem decide é o `authorizeBoard` no serviço. O mesmo vale para
  o `can` de cada linha do `/admin`: o serviço consulta `adminCan` de novo, com
  a conta alvo travada.
- **Segredo nunca leva `NEXT_PUBLIC_`.** O único valor embutido no código do
  navegador é o fuso do app.

O que é consciente, e não descuido: o cadastro diz "Esse e-mail já está em uso"
e o "Esqueci a senha" diz que não encontrou a conta, como o Laravel fazia. Só o
login esconde se a conta existe.

---

## 9. Testes

```bash
npm test               # vitest run
npm run test:watch
```

### 9.1 Um Postgres de verdade por arquivo

A suíte roda contra o **PGlite em memória** — Postgres de verdade, sem nada
para instalar —, e cada arquivo de teste ganha o seu banco
([`vitest.config.ts`](vitest.config.ts) define `PGLITE_DIR=memory://`).
[`tests/setup.ts`](tests/setup.ts) é o `RefreshDatabase`: aplica as migrations
de `drizzle/` uma vez por arquivo e trunca todas as tabelas antes de cada teste
(esvaziando também a caixa de saída do mailer `array`).

⚠️ **O `setup.ts` trunca TODAS as tabelas do schema `public`** — então os
testes nunca podem enxergar um Postgres de verdade. Duas travas garantem isso:
o [`vitest.config.ts`](vitest.config.ts) zera `DATABASE_URL` (e as URLs
diretas) no ambiente dos testes, mesmo que ela esteja exportada no terminal ou
no CI; e o próprio [`tests/setup.ts`](tests/setup.ts) se recusa a rodar se
`DATABASE_URL` existir ou se `PGLITE_DIR` não for `memory://` — a mesma lição
do `tests/bootstrap.php` do legado, que um dia apagou o banco de
desenvolvimento com a suíte passando.

Os outros ajustes do ambiente de teste estão no mesmo `vitest.config.ts`:
`TZ=UTC` (seção 7.1), `APP_TIMEZONE=America/Sao_Paulo`, `MAIL_MAILER=array` (o
`Mail::fake()` — leia `sentMail`) e o `server-only` trocado por um módulo vazio
([`tests/stubs/server-only.ts`](tests/stubs/server-only.ts)). O bcrypt roda com
4 rounds sob o Vitest.

### 9.2 Ferramentas

- [`tests/support/factories.ts`](tests/support/factories.ts) — `createUser`
  (senha "password"), `createBoard`, `addMember`, `createList`, `createCard`,
  `assign`, `createLabel`, `attachLabel`, `fresh`. Inserem direto no banco, sem
  passar pelos serviços, para o teste montar exatamente o cenário que quer —
  inclusive os que a interface não deixaria criar.
- [`tests/support/assertions.ts`](tests/support/assertions.ts) —
  `expectHttpError(promessa, status, campo?)`, o `assertForbidden()` /
  `assertNotFound()` / `assertSessionHasErrors()` para serviços.
- **Relógio congelado**: `vi.useFakeTimers({ toFake: ['Date'] })` +
  `vi.setSystemTime(...)` — o `Carbon::setTestNow`. Só o `Date`: os timers de
  verdade continuam andando, e o banco e as esperas internas não ficam presos
  num relógio parado. Como os timestamps vêm do relógio da aplicação (seção
  6.5), o `created_at` congela junto. Volte com `vi.useRealTimers()` no
  `afterEach`.

### 9.3 Em que camada testar

| Camada | Como | Exemplo |
| --- | --- | --- |
| Serviço e loader | chamada direta, sem Next | `await expectHttpError(moveCard(estranho, card.id, input), 403)` |
| Server Action | chamada como função; `vi.mock` só no que é do Next: `currentSession` de `@/server/auth/session`, `@/server/flash`, o `refresh` de `next/cache`, ou `next/headers` com um pote de cookies em memória | [`tests/parity/auth.test.ts`](tests/parity/auth.test.ts) |
| Página e layout | o Server Component é uma função async: chame-o e confira o elemento ou o `digest` do `notFound()`/`redirect()` | [`tests/parity/pages.test.ts`](tests/parity/pages.test.ts) |
| Cron | importe o `GET` da rota e passe um `Request` | [`tests/parity/auto-archive.test.ts`](tests/parity/auto-archive.test.ts) |

O destino de um redirect sai do `digest` do erro (`NEXT_REDIRECT;push;/boards/1;307;`
— o terceiro campo).

### 9.4 `tests/parity` e `tests/regressions`

- [`tests/parity`](tests/parity) é o espelho 1:1 da suíte PHPUnit do Laravel:
  cada `test_...` do antigo `tests/Feature` virou um `it('test_...')` com o
  mesmo nome, o mais perto possível do HTTP. É a prova de que a migração não
  mudou o produto. Mudou uma regra de propósito? Ajuste o teste de paridade no
  mesmo commit e diga por quê. Os casos que dependem do relógio rodam em vários
  horários do dia de São Paulo — inclusive depois das 21:00, quando o dia em
  UTC já virou e o de São Paulo ainda não (`PARITY_CLOCKS` e `PARITY_NOW` trocam
  os horários).
- [`tests/regressions`](tests/regressions) guarda um teste para cada bug achado
  na revisão da migração: o redirecionamento aberto, o filtro de destinatário
  vazio, os limites do banco, a barra de progresso presa. Bug corrigido ganha
  teste ali, com o porquê no comentário do topo.

### 9.5 O que precisa de teste

1. **Autorização** — quem não é membro recebe 403; membro comum não muda
   configuração; só o dono exclui o quadro.
2. **Escopo de dados** — o painel só lista quadros do usuário; etiqueta de outro
   quadro dá 404; card não migra entre quadros; deep link de card alheio dá 404.
3. **Ordenação** — mover card e reordenar listas realmente persistem, e ids de
   fora são ignorados.
4. **Formato do payload** — os contadores que o card exibe chegam preenchidos:

```ts
const { board: payload } = await loadBoardPage(user, board.id);

expect(payload.lists[0]!.cards[0]).toMatchObject({ checklist_total: 2, checklist_done: 1, comments_count: 1 });
```

5. **Fronteiras de data** — tudo que decide "hoje", "vencida" ou "N dias
   atrás", com o relógio congelado em mais de um horário (seção 7).

O que **não** precisa: getters, mapeamento trivial, componente que só renderiza
prop.

Não há jsdom nem teste de componente. A lógica de tela que importa é extraída
para funções puras e testada assim — os filtros do quadro
([`tests/board-filters.test.ts`](tests/board-filters.test.ts)), a barra de
progresso, a exportação ([`tests/task-export.test.ts`](tests/task-export.test.ts)).
O resto — arraste com mouse, toque e teclado; `Esc`; Voltar e F5 no deep link —
se confere no navegador antes do merge.

---

## 10. Convenções

**TypeScript**

- Estrito e **sem `any`** (o oxlint barra `typescript/no-explicit-any`). Se
  precisou, o tipo do servidor está errado.
- **Named exports** em tudo. `default export` só onde o Next exige: `page.tsx`,
  `layout.tsx`, `loading.tsx`, `error.tsx`, `global-error.tsx`, `not-found.tsx`.
  Route Handlers exportam `GET` com nome.
- Arquivo em `kebab-case.tsx`, componente em `PascalCase`, função e variável em
  `camelCase`. No banco, `snake_case` — o schema traduz.
- Importe com `@/`, nunca `../../..` (os testes importam `../support/*`).
- 4 espaços, aspas simples, ponto e vírgula, vírgula no fim
  ([`.editorconfig`](.editorconfig)). Não há formatador automático: siga o
  arquivo vizinho.
- `'use client'` só onde há estado, efeito ou evento; o resto é Server
  Component.

**Comentários** — explicam **por que**, nunca **o que**, em português.
Comentário que descreve a linha de baixo é ruído; comentário que explica a
decisão evita que alguém "conserte" o código e quebre algo. Quando a peça
substitui uma do Laravel, diga qual ("o antigo `TaskDigest`"): é o mapa de quem
conhece o sistema velho.

**Lint: oxlint, não ESLint.** O `typescript-eslint` ainda exige a API JavaScript
do TypeScript ≤ 6, e o projeto usa o TypeScript 7. O [`.oxlintrc.json`](.oxlintrc.json)
liga os plugins de TypeScript, React, Next, jsx-a11y e import, com a categoria
`correctness` como erro. Supressão (`oxlint-disable-next-line`) só com o porquê
ao lado — veja a do card em [`card-item.tsx`](src/components/board/card-item.tsx).

**Antes de commitar:**

```bash
npm run types && npm run lint && npm test
```

**Dependências** — nenhuma nova sem necessidade real, e diga no PR por que o
código existente não resolve. O [`.npmrc`](.npmrc) tem `ignore-scripts=true`:
pacote que depende de script de instalação não o roda aqui.

**Commits** — um assunto por commit. Mexeu no resource, mexa no tipo no mesmo
commit; mexeu no `schema.ts`, a migration gerada vai junto.

---

## 11. Vercel

O app inteiro é um projeto Next na Vercel: páginas, actions e crons rodam como
Vercel Functions (Node 24). As regras abaixo não são preferência: cada uma
corresponde a um jeito específico de quebrar. O passo a passo do deploy está no
[README](README.md#publicando-na-vercel).

### 11.1 Crons em UTC, com precisão de hora

O [`vercel.json`](vercel.json) agenda `/api/cron/daily-digest` em `0 10 * * *` e
`/api/cron/archive-done-cards` em `0 6 * * *` — **em UTC**. O horário que a TELA
promete (`DIGEST_AT=07:00`, `AUTO_ARCHIVE_AT=03:00`) está no fuso do app, e nada
sincroniza os dois: mudou um, mude o outro. O Brasil não tem horário de verão
desde 2019; num fuso que tenha, o cron em UTC anda uma hora duas vezes por ano.

- No plano Hobby, o cron é diário e a Vercel garante a hora, não o minuto: o
  disparo pode cair em qualquer ponto daquela hora.
- Cron só roda no deploy de **produção**, nunca em preview.
- A Vercel pode entregar o mesmo evento mais de uma vez, e não tenta de novo se
  a rota falhar. Por isso os dois jobs são **idempotentes** — o resumo reserva
  o envio do dia antes de mandar (seção 13.3), a varredura só pega card com
  `archived_at` nulo — e as rotas respondem 500 quando algo falhou, para a falha
  aparecer no painel de crons.
- Para disparar na mão, com o mesmo cabeçalho do cron:
  `curl -H "Authorization: Bearer $CRON_SECRET" "https://.../api/cron/daily-digest?dry-run=1"`.

O [`/up`](src/app/up/route.ts) responde 200 quando app e banco respondem, e 503
quando o banco não responde — é o endereço para um monitor de disponibilidade.

### 11.2 `maxDuration` e o tamanho do lote

As rotas de cron declaram `maxDuration = 300` (5 minutos) e
`dynamic = 'force-dynamic'`. Com o espaçamento que o Resend exige (600 ms entre
envios, seção 13.7), uma execução alcança umas 450 pessoas. Como quem já
recebeu fica carimbado, chamar a rota de novo continua de onde parou. Base maior
que isso pede fila (seção 17).

### 11.3 Variáveis de ambiente

A lista completa está no [`.env.example`](.env.example) e no README. O que não é
óbvio:

- **`APP_TIMEZONE` é lido no build** (vira `NEXT_PUBLIC_APP_TIMEZONE`, seção
  7.1). Trocar exige redeploy.
- **`CRON_SECRET` é obrigatório em produção**: sem ele, as rotas de cron
  respondem 401 e nada roda.
- **`APP_URL` é opcional**: sem ela, os links dos e-mails usam o domínio de
  produção que a Vercel injeta (`VERCEL_PROJECT_PRODUCTION_URL`, ver
  [`appUrl`](src/server/config.ts)) — inclusive num preview, cujo e-mail aponta
  para a produção.
- **`DATABASE_URL`** é a do pooler; **`DATABASE_URL_UNPOOLED`** ou
  **`DIRECT_URL`**, a direta, só para migrar (seção 6.3).
- **`MAIL_MAILER`** pode ficar vazio na Vercel: com `RESEND_API_KEY`, o padrão
  já é `resend`. Sem chave (ou com `MAIL_MAILER=log`), todo envio na Vercel
  falha à vista: o resumo conta a falha e não carimba o dia, e o "Esqueci a
  senha" mostra erro em vez de anunciar um link que não saiu.

### 11.4 A migration roda no build — cuidado com os previews

O build da Vercel é o `npm run vercel-build` = `db:migrate` + `next build`
([`package.json`](package.json)). Duas consequências:

1. **A migration roda antes de o código novo entrar no ar**, e o deploy
   anterior continua servindo tráfego até a troca. Toda migration precisa ser
   compatível com a versão que está no ar: adicionar coluna anulável, sim;
   renomear ou apagar coluna que o código atual lê, não. Isso se faz em dois
   deploys — primeiro o código para de usar, depois a migration apaga.
2. **Preview também faz o build — e migra.** Se o ambiente Preview aponta para
   o mesmo banco da produção, abrir um PR com uma migration a aplica no banco de
   produção antes do merge. Dê ao Preview um banco próprio (a integração do Neon
   oferece um branch de banco por preview).

### 11.5 O disco é somente leitura

A função da Vercel não tem disco gravável que sobreviva (só um `/tmp` efêmero,
de cada instância). Daí: nada de PGlite em produção (seção 6.1), nada de upload
em disco — anexos iriam para o Vercel Blob (seção 17) —, nada de arquivo de log:
`console.info` e `console.error` vão para os logs da função. O
[`next.config.ts`](next.config.ts) também tira o PGlite do pacote da função
(`outputFileTracingExcludes`).

### 11.6 Banco perto da função

Cada consulta é uma viagem de rede entre a função e o Postgres. Deixe a região
das funções (nas configurações do projeto) na mesma região do banco: o painel
faz uns dez acessos por abertura, e a distância pesa em cada um, mesmo em
paralelo. Use o pooler (seção 6.1) e mantenha `DATABASE_POOL_MAX` baixo — são
muitas instâncias, cada uma com o próprio pool.

### 11.7 Resend com domínio verificado

Enquanto o domínio não estiver verificado no painel do Resend, a API só aceita
`onboarding@resend.dev` como remetente e só entrega para o e-mail da própria
conta. Qualquer outro par devolve 403 — e isso não é silêncio: o cron marca a
linha com `✗` no log da função, não carimba o envio, e a pessoa recebe no dia
seguinte. Verifique o domínio antes de abrir o cadastro para gente de fora.

---

## 12. Painel: gráficos sem biblioteca

[`queries/dashboard.ts`](src/server/queries/dashboard.ts) alimenta
[`components/dashboard/dashboard.tsx`](src/components/dashboard/dashboard.tsx), e
os gráficos vivem em [`components/dashboard/`](src/components/dashboard).

### 12.1 Duas escalas, ditas em voz alta

O painel mistura dois recortes, e cada bloco diz qual está usando:

| Bloco | Escala |
| --- | --- |
| Cartões do topo, anel de prazos, próximos prazos | **Suas tarefas** — só cards atribuídos (`assignedTo`) |
| Ritmo, progresso por quadro, atividade | **Seus quadros** — tudo, inclusive o trabalho dos colegas |

Sem essa distinção o número não significa nada: "12 tarefas abertas" é uma
coisa se são suas e outra se é o quadro inteiro do time.

O `assignedTo` mora em [`queries/scopes.ts`](src/server/queries/scopes.ts), e não
em cada consulta, porque é a **mesma** definição que o resumo diário usa. Se as
duas divergirem, o e-mail passa a mentir sobre a tela — e ninguém confere isso
até alguém reclamar.

### 12.2 Agregue no banco, não no navegador

Nenhuma consulta do painel traz linha que a tela não vá desenhar, salvo duas
exceções pensadas. Os totais saem de `count()` e de
`count(...) filter (where ...)`; o gráfico de ritmo, de um `GROUP BY` do dia no
fuso do app.

A primeira exceção é o anel, que traz só a coluna `due_at` dos abertos e separa
no Node:

```ts
const rows = await db
    .select({ dueAt: cards.dueAt })
    .from(cards)
    .where(and(assignedTo(userId), isNull(cards.completedAt)));
```

Uma consulta trazendo uma coluna só, em vez de cinco `COUNT`s com `CASE WHEN` —
e, de quebra, as fronteiras entre "hoje" e "próximos dias" são exatamente as de
`dayBoundaries`, o mesmo código do resumo diário, não uma tradução dele para
SQL. Vale enquanto o volume for de centenas de cards. Passando disso, vire
`count(*) filter (where ...)` — e escreva um teste que trave os números antes de
mexer.

A segunda é o progresso por quadro, que traz uma linha por quadro (não só os
seis da tela): a ordem dos títulos é decidida no Node, com `Intl.Collator`
(seção 6.4), e cortar no banco escolheria os seis pela collation dele.

### 12.3 Dias sem movimento entram com zero

```ts
return Array.from({ length: TREND_DAYS }, (_, offset) => {
    const date = calendarDay(start.year, start.month, start.day + offset);

    return { date, created: created.get(date) ?? 0, completed: completed.get(date) ?? 0 };
});
```

O `GROUP BY` só devolve os dias em que aconteceu alguma coisa. Plotar o
resultado direto encurtaria o eixo, e o domingo parado viraria uma linha reta
entre sexta e segunda — o gráfico mostraria um ritmo constante que não existiu.
Travado por `test_the_trend_fills_days_without_movement`, em
[`tests/parity/dashboard-digest.test.ts`](tests/parity/dashboard-digest.test.ts).

### 12.4 SVG na mão, sem lib de gráfico

Nenhuma dependência nova. Os motivos, em ordem:

1. Uma lib de charts custa 50–150 kB gzip para desenhar quatro formas.
2. Tema claro/escuro em runtime: o SVG usa `var(--primary)`, `var(--danger)`
   direto no atributo `stroke`, então trocar de tema já troca o gráfico. Com lib,
   isso vira remontagem do componente com um objeto de tema.
3. As animações são as mesmas do resto do app (`motion`), com o mesmo easing.

O que isso exige em troca:

- **Curva com tangente horizontal**, não spline solto
  ([`trend-chart.tsx`](src/components/dashboard/trend-chart.tsx)). Um Catmull-Rom
  passa acima do maior valor entre dois picos; num gráfico de contagem isso é
  mentira visual — desenha 4 onde o dado diz 3.
- **`vectorEffect="non-scaling-stroke"`** nas linhas: o `viewBox` escala com a
  largura do cartão, e a espessura do traço iria junto.
- **Dia solto não é instante.** "2026-08-13" lido por `new Date()` é meia-noite
  UTC — 21:00 do dia 12 em São Paulo —, e o eixo mostraria o dia anterior. O
  gráfico ancora ao meio-dia UTC e formata em UTC (seção 7.2).

### 12.5 Número que sobe sem re-renderizar

[`useCountUp`](src/hooks/use-count-up.ts) devolve um `MotionValue`, não um
estado:

```tsx
const count = useCountUp(value);

return <motion.p>{count}</motion.p>;
```

O `motion` escreve direto no nó de texto. Com `useState` seriam ~55 renders do
componente por número, quatro números na tela ao mesmo tempo. Mesma ideia no
anel ([`donut-chart.tsx`](src/components/dashboard/donut-chart.tsx)): o
`strokeDasharray` cresce por `useMotionTemplate`, não por estado.

### 12.6 `prefers-reduced-motion` não chega ao JS

O bloco global do `globals.css` zera **transição e animação CSS**. Ele não
alcança nada que o `motion` anime por JS. Onde a animação é em JS, a checagem é
explícita:

```tsx
const reduced = usePrefersReducedMotion();

useEffect(() => {
    if (reduced) {
        raw.set(value);

        return;
    }
    // ... anima
}, [/* ... */]);
```

E pelo [`usePrefersReducedMotion`](src/hooks/use-prefers-reduced-motion.ts), não
pelo `useReducedMotion()` do `motion`: este responde `null` no SSR e `true` na
hidratação (erro de hidratação, seção 7.4), e é um retrato tirado na montagem —
não acompanha a preferência mudando com o app aberto.

Sem isso, quem pediu menos movimento ao sistema continua vendo números girando e
arcos crescendo.

### 12.7 O feed é acessório: chega depois e falha sozinho

A atividade recente é o pedaço mais caro e o menos urgente do painel. A página
a entrega como Promise sem `await` e o painel a lê num `<Suspense>` (seção 3.7);
se a consulta falhar, o `.catch` da página a transforma em `null` e só o
quadrinho do feed avisa — o resto do painel fica de pé.
`test_the_activity_feed_is_deferred` trava que ela não vem junto com o resto.

### 12.8 "Vencida" é o dia, não a hora

Um card marcado para **hoje às 10:00** continua sendo "de hoje" às 11:00. Ele só
vira vencido na virada da meia-noite, no fuso do app.

```ts
// src/server/services/task-digest.ts
const { startOfToday, endOfToday, horizon } = dayBoundaries(now);

overdue: due.filter((card) => card.dueAt! < startOfToday),
today:   due.filter((card) => card.dueAt! >= startOfToday && card.dueAt! <= endOfToday),
```

Comparar com o `now` cru parece mais exato e é pior de usar: a tela ficaria
vermelha no meio da manhã, e o card de hoje disputaria atenção com o que está
atrasado há três dias. Quando tudo é urgente, nada é.

A regra existe em mais de um lugar — `dayBoundaries`, em
[`task-digest.ts`](src/server/services/task-digest.ts), para o resumo e os
números do painel; o `overdue` do progresso por quadro, em SQL; e
[`dueState()`](src/lib/utils.ts), no cliente, para o selo do card. Mexeu numa,
mexa nas outras: senão o mesmo card aparece vermelho ao lado de um contador que
o chama de "hoje".

### 12.9 Coluna de conclusão: `board_lists.is_done`

Arrastar um card para uma coluna marcada com `is_done` grava `completed_at`;
tirar de lá limpa. Sem isso, "Concluído" era só um nome: o painel contava o card
como aberto e, se tivesse prazo, como vencido.

O que a regra **não** faz é igualmente importante — só o **cruzamento** da
fronteira mexe em `completed_at` (`completionCrossing`, em
[`services/cards.ts`](src/server/services/cards.ts)):

| Movimento | `completed_at` |
| --- | --- |
| comum → conclusão | grava agora |
| conclusão → comum | limpa |
| comum → comum | não toca |
| conclusão → conclusão | não toca |

Mover entre duas colunas comuns não pode desmarcar um card que a pessoa concluiu
na caixinha do modal. A caixinha é uma decisão manual; arrastar não a desfaz
(`test_moving_between_ordinary_columns_does_not_undo_a_manual_completion`).

Marcar uma coluna já cheia como "de conclusão" alcança quem está lá dentro
(`updateList`) — o contrário deixaria a pessoa marcando a coluna e os cards
continuando abertos. Todo quadro novo já nasce com a coluna "Concluído" marcada
([`services/boards.ts`](src/server/services/boards.ts)); daqui para a frente
quem manda é a flag, não o nome.

---

## 13. E-mail: o resumo diário

Uma vez por dia, o que está vencido e o que vence em seguida. As peças:
[`task-digest.ts`](src/server/services/task-digest.ts) (os dados — o antigo
`TaskDigest`), [`mail/daily-digest.ts`](src/server/mail/daily-digest.ts) (o
e-mail: assunto, cabeçalhos, HTML e texto),
[`services/daily-digest.ts`](src/server/services/daily-digest.ts) (o disparo,
`runDailyDigest`) e as portas que o chamam: o cron
[`api/cron/daily-digest`](src/app/api/cron/daily-digest/route.ts), o
`npm run digest` ([`scripts/daily-digest.ts`](scripts/daily-digest.ts)) e o
botão "Enviar agora para mim" de Configurações › Notificações.

### 13.1 O dia é o do fuso do app

O cron dispara às 10:00 UTC, que são 07:00 em São Paulo, e tudo o que o resumo
decide — "vencida", "vence hoje", "já recebeu hoje" — usa o dia do fuso do app
(seção 7). Com o dia em UTC, das 21:00 à meia-noite todo card de amanhã
apareceria como "vence hoje": era exatamente o bug do Laravel com `UTC` no
config.

### 13.2 Só cards atribuídos, e só de quadros vivos

```ts
// src/server/queries/scopes.ts
export function assignedTo(userId: number, history = false): SQL {
    return and(
        history ? counted() : isNull(cards.archivedAt),
        exists(/* card_user: o card é desta pessoa */),
        exists(/* boards: quadro vivo, e ela ainda é membro dele */),
    )!;
}
```

O segundo `exists` parece redundante e não é: sair de um quadro **não** apaga as
atribuições de card. Sem ele, quem foi removido do quadro continuaria recebendo
lembretes de tarefas que já nem consegue abrir — vazamento de dado por e-mail, o
pior lugar para vazar, porque fica no histórico de quem recebeu
(`test_it_ignores_cards_of_other_people_and_of_boards_the_user_left`).

Autorização em consulta de lote é a mesma regra da seção 2.4: não há uma pessoa
logada para a policy conferir, então o filtro tem que estar no `WHERE`.

### 13.3 O carimbo é a trava contra o envio duplo

`users.digest_last_sent_at` guarda o último envio bem-sucedido, e o disparo pula
quem já recebeu hoje. Sem isso, um disparo manual depois do cron, um
`npm run digest` rodado por engano ou a Vercel entregando o mesmo evento duas
vezes mandariam o mesmo e-mail duas vezes — e a segunda cópia treina a pessoa a
ignorar a primeira.

Em serverless a checagem sozinha não basta: duas execuções simultâneas passariam
juntas por ela. Por isso o envio é **reservado antes de sair** (`claim`): um
UPDATE condicional grava o carimbo só se ainda não houver um do mesmo dia, e só
quem conseguiu gravar manda. Se o envio falhar, `release` devolve o carimbo
anterior e a próxima rodada tenta de novo. É o `withoutOverlapping()` do
agendador do Laravel, trazido para o serverless.

Regras que caem junto:

- **`--force` / `?force=1`** fura a trava, o opt-out e o "nada a relatar". É a
  válvula para teste manual; com ela não há reserva, e o carimbo vem depois do
  envio.
- **O botão "Enviar agora para mim" NÃO carimba.** Testar não pode consumir o
  envio real do dia (`test_the_test_send_does_not_consume_the_day`).
- **Falha de um endereço não derruba o lote.** O `try/catch` por pessoa desfaz a
  reserva, conta a falha e segue; no fim, a rota responde 500.
- **`?user=` vazio não casa com ninguém.** Lido como "sem filtro", um
  `?user=&force=1` digitado pela metade mandaria o resumo para a base inteira,
  opt-out incluído (`recipientFilter`).

### 13.4 Não mandar é uma feature

`config.digest.skipWhenEmpty` corta o envio de quem não tem nada vencido, nada
no horizonte e nada concluído nas últimas 24 h. Um resumo diário que chega vazio
todo dia vira ruído em duas semanas, e aí o dia em que ele traz algo urgente
também é ignorado. A tela de notificações mostra a prévia do que sairia hoje,
inclusive quando a resposta é "o envio de hoje seria pulado".

### 13.5 HTML de e-mail é HTML de 2005

[`mail/daily-digest.ts`](src/server/mail/daily-digest.ts) monta o HTML como
texto, com tabela, largura fixa e estilo inline, porque cliente de e-mail
descarta `<style>` externo, flexbox e grid. Todo valor que entra no HTML passa
por `escapeHtml` — título de card e nome de quadro vêm de gente. Regras
aplicadas ali:

- Gradiente **sempre** com `background-color` sólido antes do
  `background-image`: o Outlook ignora o gradiente, e ficaria texto branco no
  branco.
- A faixa colorida da lateral é um `<td width="4">`, não `border-left`.
- Nenhuma imagem remota: quase todo cliente bloqueia por padrão, e um layout que
  depende de imagem chega quebrado.
- Cabeçalho `List-Unsubscribe` — sem ele, quem quer sair marca como spam, e isso
  queima a reputação do domínio no Resend. Hoje ele aponta para a página de
  notificações; o descadastro de um clique está na seção 17.
- Versão em texto puro junto (`digestText`), para quem não renderiza HTML.

As datas imitam o Carbon em pt_BR ("12 de out", "ter, 13 de out"), com os nomes
de mês e de dia escritos no código: o `Intl` escreve "out." e "ter.".

### 13.6 Os mailers

`MAIL_MAILER` escolhe ([`mailer.ts`](src/server/mail/mailer.ts)):

| Mailer | Para quê |
| --- | --- |
| `log` | Padrão sem `RESEND_API_KEY`: imprime no terminal e nada sai para a internet por acidente. Em produção, nem o corpo (seção 8). |
| `smtp` | Mailpit no desenvolvimento (`MAIL_HOST=127.0.0.1`, `MAIL_PORT=1025`) — é onde se olha o layout. |
| `resend` | Entrega de verdade. Padrão quando há `RESEND_API_KEY`. |
| `array` | Testes: guarda em `sentMail`, o `Mail::fake()`. |

### 13.7 Sem fila, com ritmo

O e-mail sai na hora, sem fila: quem dispara já roda fora do ciclo de uma tela
(o cron, o script, o botão), e uma fila exigiria um worker de pé só para isso. O
Resend aceita poucas requisições por segundo por conta, então o lote espaça os
envios em 600 ms (`RESEND_SPACING_MS`) — em fila cerrada, o terceiro e-mail já
tomaria 429. O teto por execução está na seção 11.2.

---

## 14. Arquivamento dos concluídos

Cada quadro escolhe em quantos dias um card concluído sai da coluna
(`boards.auto_archive_done_after_days`: nunca — o padrão —, 1, 3, 7, 14 ou 30).
A varredura mora em [`done-card-archiver.ts`](src/server/services/done-card-archiver.ts).

### 14.1 Arquivar não apaga — e não desfaz o progresso

O card continua no banco com `archived_at`: some das colunas, fica na gaveta
"Arquivados" e volta com um clique. E continua **contando** no progresso — é o
recorte `counted()` de [`scopes.ts`](src/server/queries/scopes.ts):

```ts
export function counted(): SQL {
    return or(isNull(cards.archivedAt), isNotNull(cards.completedAt))!;
}
```

O que ainda está no quadro, mais o que saiu de lá já concluído. Sem isso, ligar
o arquivamento faria a barra do quadro voltar de 100% para 0% justamente por o
trabalho ter terminado, e a linha de "concluídos" do gráfico de ritmo achataria.
O card arquivado SEM concluir foi abandonado de propósito: sai dos dois lados da
conta.

| A pergunta | O recorte |
| --- | --- |
| O que FALTA (Kanban, abertos, vencidos, prazos, resumo diário) | `archived_at is null` |
| O que foi FEITO (progresso em `/boards` e no painel, ritmo, "concluídas na semana") | `counted()` — ou `assignedTo(userId, true)` para as tarefas da pessoa |

Travado por `test_archiving_does_not_undo_the_progress_of_the_board`, em
[`tests/parity/auto-archive.test.ts`](tests/parity/auto-archive.test.ts).

### 14.2 O relógio é o `completed_at`

O prazo conta de quando a tarefa terminou, não da última vez que alguém encostou
no card: reordenar uma coluna toca o `updated_at` de todo mundo que está nela, e
com ele o prazo nunca venceria num quadro em uso. Os dias são de calendário, no
fuso do app (`addAppDays`).

### 14.3 Três portas, um filtro

O cron (03:00 em São Paulo, para o card sair entre um expediente e outro, e não
debaixo do cursor de alguém), o `npm run archive-done` e o botão "Arquivar
agora" (owner/admin) usam o mesmo filtro — e o dry-run conta com ele também, a
única forma de a simulação valer alguma coisa. O botão existe porque o recurso é
invisível até a primeira vez que acontece: transforma a promessa em resultado.

- O histórico ganha **uma** linha por varredura, não uma por card: vinte
  "arquivou tal card" seguidos afogariam o feed no dia em que alguém liga o
  recurso. Na varredura agendada a linha fica sem autor — ninguém clicou.
- Quadro sem prazo nunca é tocado, e esse é o estado de todo quadro novo: cards
  sumindo sozinhos precisam ser uma decisão consciente. Pelo mesmo motivo, a
  troca de prazo vai para o histórico do quadro — a resposta tem de estar lá
  quando alguém que não viu a mudança perguntar para onde foram os cards.

### 14.4 Restaurar reabre

Restaurar limpa o `completed_at`: um card que voltasse ainda concluído passaria
de novo pelo filtro e sumiria na madrugada seguinte. Pelo mesmo motivo, ele não
volta para a coluna de conclusão — vai para o fim da primeira coluna comum, e o
toast diz para onde foi
(`test_restoring_reopens_the_card_and_takes_it_out_of_the_done_column`).

Arquivar na mão não exige estar concluído: é como se guarda o que foi
abandonado. E arquivar o que já está arquivado não faz nada — o filtro
`archived_at is null` está no próprio UPDATE, contra o clique duplo.

### 14.5 A gaveta é lida ao abrir

O payload do quadro só traz `archived_count`, para o selo do menu. A lista em si
(até 100, `config.limits.archivedPerBoard`) é lida por `loadArchivedCards` a
cada abertura da gaveta, porque arquivar e restaurar a mudam. Restaurar e
"Arquivar agora" devolvem a gaveta atualizada como dado da action, e o quadro
volta pelo `refresh()` — os dois na mesma resposta.

---

## 15. Exportar tasks como prompt

O quadro vira texto separado em sprints, para colar num LLM. Tudo acontece no
cliente: [`task-export.ts`](src/lib/task-export.ts) monta as sprints e escreve a
string, com funções puras; [`export-modal.tsx`](src/components/board/export-modal.tsx)
só cuida do estado e dos botões.

### 15.1 O detalhe vem por action de leitura, não com o quadro

O texto precisa da descrição, da checklist e dos comentários de **todos** os
cards selecionados — dados que o Kanban nunca carrega. Carregá-los no layout
seria rodar essa consulta em **toda** visita ao quadro.

Por isso o modal chama `loadExportDetails` (`refresh: false`, seção 3.7) na
primeira abertura e guarda o resultado pelo resto da visita; se o pedido falhar,
a próxima abertura tenta de novo. Era a prop `Inertia::optional`
(`test_the_export_detail_stays_out_of_the_first_paint`).

**Não se cria rota `/api/export`** (regra da seção 1): a exportação é uma action
de leitura da mesma tela.

### 15.2 O detalhe complementa o card, não o repete

O `cardExportResource` devolve só `id`, `description`, `checklists` e
`comments`. Título, prazo, etiquetas e responsáveis já vieram dentro de `board`,
e o cliente casa os dois pelo `id`. Repetir tudo dobraria um payload que já
carrega o quadro inteiro — por isso [`tests/export.test.ts`](tests/export.test.ts)
trava a lista de chaves.

### 15.3 Modo seleção desliga o arraste

Enquanto a pessoa marca dez cards seguidos, um card que se move é acidente e não
gesto. `CardItem` recebe `selectMode` e passa `disabled` ao `useSortable`; o
clique vira marcação e o card ganha `role="checkbox"` com `aria-checked` — sem
os `attributes` do dnd-kit, o `tabIndex` e o Enter/Espaço passam a ser
responsabilidade nossa.

O `Esc` sai do modo, **exceto** com um diálogo aberto por cima: lá o `Esc` é do
diálogo, e fechar os dois de uma vez jogaria a seleção fora sem querer.

### 15.4 Sprint é um agrupamento, não uma entidade

Não existe tabela `sprints`. Os quatro modos são funções puras sobre a lista de
cards selecionados:

| Modo | Regra |
| --- | --- |
| Por lista | uma sprint por coluna, com o nome da coluna |
| Por prazo | janelas de N semanas **ancoradas na primeira tarefa de cada janela** |
| Tamanho fixo | blocos de N tarefas, na ordem do quadro |
| Manual | nomes e alocação editáveis, semeados pelo modo anterior |

A âncora móvel do modo "por prazo" evita o que uma grade fixa faria: doze
sprints vazias entre uma tarefa de agosto e outra de novembro.

Entrar no modo manual **semeia** os nomes e a alocação a partir das sprints que
estavam na tela. Começar do zero jogaria fora o agrupamento que a pessoa acabou
de escolher.

### 15.5 Data com ano, no fuso do app; etiqueta sem nome fica de fora

O texto é lido fora do app, meses depois. Por isso ele tem o próprio
formatador, com ano — e não o `formatDate()` de `lib/utils`, que corta o ano
porque ali o contexto é o quadro aberto agora. O dia, porém, é o do fuso do
app, como em toda data da tela: o prazo que o texto diz tem de ser o dia que o
card mostra, qualquer que seja o fuso do computador de quem exporta. A semana
das sprints "por prazo" começa na segunda, também no fuso do app.

Pela mesma lógica de leitor sem contexto, etiqueta sem nome não entra: a cor
diz algo no card, nada num prompt.

---

## 16. Administração do Taskon

O painel [`/admin`](src/app/(app)/admin/page.tsx) é de quem administra o
**Taskon inteiro** — não confundir com o papel "admin" de um quadro
(`board_user.role`). Quem pode o quê mora numa política pura,
[`src/server/policies/admin.ts`](src/server/policies/admin.ts): o serviço
([`admin.ts`](src/server/services/admin.ts)) a confere em toda operação, e a
tela a usa só para esconder botões (o `can` de cada linha).

| Ação | Admin nativo | Admin concedido |
| --- | :---: | :---: |
| Abrir o painel e ver o histórico | ✓ | ✓ |
| Bloquear / desbloquear conta comum | ✓ | ✓ |
| Conceder / tirar admin | ✓ | |
| Bloquear / desbloquear um admin | ✓ | |
| Qualquer coisa numa conta de e-mail nativo | | |
| Qualquer coisa na própria conta | | |

Conceder fica só com o nativo: se um admin concedido pudesse criar outros (ou
tirar e bloquear os colegas), um descuido viraria disputa de poder sem árbitro.
Conta bloqueada não recebe admin (desbloqueie antes), e bloquear um admin não
tira o `is_admin` dele: desbloqueado, ele volta como era.

### 16.1 O admin nativo precisa provar o e-mail

Nativo é a conta cujo e-mail está em `config.admin.nativeEmails`
(`NATIVE_ADMIN_EMAILS`, por padrão `victorgabriel08fs@gmail.com`) **e** que tem
`email_verified_at` preenchido. A lista está no código, o repositório é público
e o cadastro não verifica e-mail: sem a prova, qualquer um criaria a conta com
aquele endereço — ou trocaria o próprio e-mail para ele no perfil — e viraria
admin.

A prova é a caixa de entrada, por um de dois caminhos, que terminam os dois em
`markEmailVerified`:

- o **link de confirmação** que a tela de ativação do `/admin` manda
  ([`email-verification.ts`](src/server/services/email-verification.ts)). O
  token vale 24 h e uma vez só, fica amarrado ao e-mail do pedido (trocar de
  endereço antes de clicar mata o link) e é gasto por um botão (POST), não ao
  abrir a página: os scanners dos provedores de e-mail fazem GET no link antes
  da pessoa;
- uma **redefinição de senha concluída** — aquele link também só chega à caixa
  dela.

Trocar o e-mail no perfil zera `email_verified_at`. Quem ocupar o endereço
nativo antes do dono fica intocável pelo painel, mas sem poder nenhum; o dono
toma a conta pelo "Esqueci a senha", que ainda derruba as sessões do ocupante.
A ativação entra no histórico (`admin.activated`), com a própria conta como
autora.

Em produção, tudo isso depende do Resend: sem e-mail, nem o link nem a
redefinição chegam. Em último caso, preencher `email_verified_at` da conta
direto no banco também ativa — só não deixa o evento no histórico.

### 16.2 Bloquear é tirar da conta, não apagar

Bloquear grava `blocked_at`/`blocked_by`, **apaga todas as sessões** da conta
(inclusive as de "lembrar de mim": a próxima requisição de qualquer aba ou
aparelho já chega como visitante) e registra `user.blocked`. Quadros, cards e
participações ficam como estão; desbloquear devolve tudo, menos as sessões
derrubadas — a pessoa entra de novo com a senha de sempre. Por defesa em
profundidade, `currentSession` também ignora a sessão de conta bloqueada, e o
resumo diário nunca vai para ela, nem com `--force`.

O login confere a senha **antes** de falar do bloqueio: com a senha errada a
resposta é a de sempre (e conta no rate limit), para quem não sabe a senha não
descobrir quais contas existem ou foram bloqueadas. O "Esqueci a senha" de uma
conta bloqueada funciona como qualquer outro — trocar a senha não desbloqueia.

### 16.3 Detalhes que importam

- **404, não 403.** Para quem não administra, o painel não existe — um 403
  confirmaria que há algo ali. Por isso a rota não tem `loading.tsx` (o
  esqueleto sairia no stream, com status 200, antes da decisão), o título da aba
  só vira "Administração" para quem administra, e o item do menu da conta só
  aparece para quem tem `auth.user.admin` (o nativo pendente incluído: é no
  `/admin` que ele pede o link).
- **Decide o estado de agora, não o da tela.** Cada operação trava a linha da
  conta alvo (`FOR NO KEY UPDATE`) antes de consultar a política: dois cliques,
  ou dois admins, entram em fila, e o segundo recebe 422 ("já está
  bloqueado(a)") sem evento repetido. Quem não administra recebe o mesmo 403
  com qualquer id, antes de o alvo ser procurado — a diferença 403/404 não
  revela quais contas existem.
- **A recusa também atualiza a tela.** Um 403/422 nessas actions quase sempre
  quer dizer tela velha (outra aba, outro admin), então a action chama
  `refresh()` antes de responder: o botão que não vale mais some junto com o
  toast, e quem perdeu o admin já cai no 404.
- **Histórico** (`admin_events`): conceder, tirar, bloquear, desbloquear e
  ativar, cada um na mesma transação da mudança — mudança de poder sem rastro
  não acontece. Nome e e-mail do alvo são copiados para a linha continuar
  legível se a conta for excluída.
- **Busca, filtro e página moram na URL** (sobrevivem ao F5 e ao Voltar). A
  busca é `ILIKE` em nome e e-mail, escapando `%`, `_` e `\`: senão "100%"
  viraria curinga.
- **Faxina**: os pedidos de confirmação vencidos saem no cron noturno, junto
  com sessões, convites e janelas de rate limit.
- **No desenvolvimento**, ponha `NATIVE_ADMIN_EMAILS=victor@taskon.test` no
  `.env.local`: as contas do seed já nascem com o e-mail confirmado.

Testes: [`tests/admin.test.ts`](tests/admin.test.ts) (a tabela de hierarquia
inteira, o bloqueio, o histórico e o painel),
[`tests/email-verification.test.ts`](tests/email-verification.test.ts),
[`tests/blocked-users.test.ts`](tests/blocked-users.test.ts),
`tests/admin-review/` e, em `tests/regressions/`, os `admin-*.test.ts` e
`email-verification-housekeeping.test.ts`.

---

## 17. O que ficou de fora (e como fazer)

| Item | Caminho |
| --- | --- |
| Tempo real (ver o card do colega mover) | A Vercel não segura WebSocket aberto numa função. Um pub/sub gerenciado (Ably, Pusher, Supabase Realtime) recebe o evento que `src/server/services` publica depois de gravar; o `BoardShow` assina o canal do quadro e aplica o evento no espelho local (respeitando o `isDragging`) ou pede um `router.refresh()`. |
| Anexos em cards | Vercel Blob, com upload direto do navegador (client upload, o token emitido por um Route Handler que autoriza pelo quadro): o corpo de uma Server Action para em 1 MB e o disco da função é somente leitura. Tabela `attachments` com índice em `card_id`; excluir o card precisa apagar os blobs, que o `CASCADE` do banco não alcança. |
| Markdown na descrição | Renderizar no cliente com sanitização; **nunca** `dangerouslySetInnerHTML` sem sanitizar. |
| Busca global entre quadros | Full-text do Postgres: coluna `tsvector` gerada (`to_tsvector('portuguese', ...)`) com índice GIN, ou `pg_trgm` para pedaço de palavra. Página `/search` como Server Component, sempre filtrando por quadros de que a pessoa é membro — o mesmo `exists(board_user…)` que `assignedTo` usa em [`scopes.ts`](src/server/queries/scopes.ts). |
| Notificação por e-mail em menção | Detectar `@nome` no `addComment` e mandar com `after()` (de `next/server`), para a action não esperar o Resend nem segurar a fila da aba (seção 3.3). Volume alto → fila. |
| Fuso por usuário | Coluna `timezone` em `users`; converter na borda (formulário, `dueState`, e-mail), com o banco em UTC e o `APP_TIMEZONE` virando só o padrão (seção 7.3). |
| Horário do resumo por usuário | Coluna `digest_at` + cron de hora em hora (o plano Hobby só agenda cron diário) mandando para quem marcou aquela hora; o carimbo diário continua valendo. Hoje o horário é um só, global (seção 13). |
| Resumo para bases grandes | Passou de umas 450 pessoas por execução (seção 11.2)? API de lote do Resend (até 100 e-mails por chamada) ou uma fila de verdade. |
| Verificação de e-mail para todos | O fluxo já existe (seção 16.1) e a action `requestEmailVerification` serve a qualquer conta logada, mas a tela só o oferece na ativação do admin nativo. Falta oferecê-lo a todos (um aviso no painel, e em Configurações › Perfil depois de trocar o e-mail) e não mandar o resumo para endereço não verificado. |
| Descadastro de um clique (RFC 8058) | Gmail e Yahoo exigem de quem manda volume: cabeçalho `List-Unsubscribe-Post: List-Unsubscribe=One-Click` + uma URL HTTPS com token assinado por pessoa, servida por um Route Handler POST que desliga `daily_digest` sem sessão. Hoje o `List-Unsubscribe` aponta para `/settings/notifications`. |
| 403 com status HTTP 403 | Hoje o layout do quadro renderiza `<Forbidden />` com status 200. Quando o `forbidden()` sair do experimental (hoje exige `experimental.authInterrupts`), trocar o `return <Forbidden />` por `forbidden()` e mover a tela para `src/app/forbidden.tsx`. |
| Derrubar as outras sessões ao trocar a senha | Como no legado, trocar a senha mantém as outras sessões (a redefinição por e-mail já derruba todas). Para mudar: na action `updatePassword`, apagar as linhas de `sessions` do usuário com `id` diferente da sessão atual ([`session.ts`](src/server/auth/session.ts) expõe `currentSession()`). |
| Arquivar quadros e listas | `archived_at` já existe em `boards` e `board_lists`, e as consultas já filtram por ele; faltam a action e a UI. Os cards já arquivam (seção 14). |
| Faxina do histórico | `activities` só cresce. Uma poda no cron noturno (manter N dias), junto da faxina de sessões e rate limits. |
| Testes de ponta a ponta | Playwright contra `next build && next start` com um banco descartável. Hoje o arraste, o deep link e o `Esc` são conferidos à mão (seção 9.5). |

Ao pegar um destes: comece pelo `schema.ts` e pela migration gerada, depois o
tipo em `src/types`, o serviço (com a autorização), o resource, a action no
`contract.ts` e só então o componente. Nessa ordem o TypeScript te guia.
