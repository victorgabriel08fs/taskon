# Boas práticas — Taskon

Guia de como este projeto é escrito e por quê. Não é um manual genérico de
Laravel/React: cada regra aqui aponta para um arquivo real do repositório.
Se for mexer no código, leia isto antes.

---

## 1. Arquitetura

```
Navegador  ──►  React 19 (TypeScript)
                     ▲
                     │  props tipadas, sem camada de API
                     ▼
              Inertia.js v3
                     ▲
                     │  sessão do Laravel (cookie), CSRF nativo
                     ▼
              Laravel 13  ──►  MySQL
```

**Por que Inertia e não uma SPA + API REST?** Porque não existe um segundo
cliente. Uma API separada custaria: tokens, CORS, versionamento, duplicação de
validação e um estado de servidor no cliente para sincronizar. Com Inertia o
controller devolve props tipadas direto para o componente e a autenticação é a
sessão do Laravel — o mesmo `auth` middleware que protegeria um Blade.

**Regra:** enquanto o único consumidor for este frontend, não crie rotas
`/api/*`. Se um dia existir um app mobile, aí sim: `routes/api.php` + Sanctum,
reaproveitando os mesmos Form Requests e Policies.

### Mapa de pastas

| Caminho | Responsabilidade |
| --- | --- |
| `app/Models` | Eloquent puro: relações, casts, scopes. Sem regra de aplicação. |
| `app/Policies` | Autorização. Uma policy por agregado ([`BoardPolicy`](app/Policies/BoardPolicy.php)). |
| `app/Http/Controllers` | Orquestração fina: valida → autoriza → persiste → redireciona. |
| `app/Http/Resources` | Contrato de saída. Espelha 1:1 os tipos em `resources/js/types`. |
| `app/Support` | Serviços sem estado ([`ActivityLogger`](app/Support/ActivityLogger.php), [`DemoBoardBuilder`](app/Support/DemoBoardBuilder.php)). |
| `resources/js/pages` | Uma pasta por rota. O nome do arquivo é o `Inertia::render()`. |
| `resources/js/components/ui` | Primitivos reutilizáveis, sem conhecer o domínio. |
| `resources/js/components/board` | Componentes que sabem o que é card, lista, etiqueta. |
| `resources/js/layouts` | Casca das páginas (cabeçalho, navegação, painel de auth). |

---

## 2. Backend

### 2.1 Controllers finos, sem regra escondida

Um método de controller faz quatro coisas, nessa ordem: **autoriza, valida,
persiste, redireciona**. Se passar de ~30 linhas, extraia para `app/Support`.

```php
public function store(Request $request, BoardList $list): RedirectResponse
{
    $this->authorize('update', $list->board);          // 1. autoriza

    $validated = $request->validate([                  // 2. valida
        'title' => ['required', 'string', 'max:500'],
    ]);

    // 3. persiste
    $card = new Card([...]);
    $card->save();

    return back();                                     // 4. redireciona
}
```

**Nunca retorne JSON de um controller web.** Retorne `back()` ou
`redirect()->route(...)`. O Inertia transforma o redirect em uma revisita e o
React recebe as props novas — é o que mantém cliente e servidor em sincronia
sem código de sincronização.

### 2.2 Autorização sempre pelo agregado

Card, lista, etiqueta e comentário não têm policy própria: todos pertencem a um
quadro, e é o quadro que decide.

```php
$this->authorize('update', $card->board);
$this->authorize('manage', $board);   // configurações do quadro: só owner/admin
```

Três verbos, e só três:

- `view` — é membro
- `update` — pode mexer no conteúdo (qualquer membro)
- `manage` — pode mexer nas configurações, etiquetas e membros (owner/admin)
- `delete` — só o dono

Quando o identificador vem cru na URL (`/cards/{card}/labels/{labelId}`),
**valide que ele pertence ao quadro** antes de usar:

```php
abort_unless($card->board->labels()->whereKey($labelId)->exists(), 404);
```

Sem essa linha, qualquer membro conseguiria colar uma etiqueta de outro quadro
no card. O teste [`test_labels_are_toggled_and_scoped_to_the_board`](tests/Feature/CardTest.php)
existe exatamente para travar isso.

### 2.3 Resources como contrato

Nada de `return Inertia::render('boards/show', ['board' => $board])`. O model
inteiro vazaria colunas internas e mudaria de formato a cada migration.
Use um Resource e mantenha o tipo TS correspondente ao lado:

| Resource | Tipo TypeScript |
| --- | --- |
| `BoardResource` | `Board` |
| `CardResource` | `Card` (versão leve, para o Kanban) |
| `CardDetailResource` | `CardDetail` (versão completa, para o modal) |

`JsonResource::withoutWrapping()` está ligado em
[`AppServiceProvider`](app/Providers/AppServiceProvider.php) — sem o envelope
`data`, o prop no React tem exatamente o formato do `toArray()`.

**Ao adicionar um campo:** mude o Resource **e** o tipo em
`resources/js/types/index.d.ts` no mesmo commit. Se esquecer, o `npm run types`
avisa.

### 2.4 Consultas: nunca deixe o N+1 nascer

O payload do quadro carrega listas, cards, etiquetas, membros e contadores em
**uma** árvore de eager loading ([`BoardController::show`](app/Http/Controllers/BoardController.php)):

```php
$board->load([
    'members',
    'labels',
    'lists' => fn ($q) => $q->whereNull('archived_at')->with([
        'cards' => fn ($q) => $q->whereNull('archived_at')->orderBy('position')
            ->with(['labels:id', 'members:id'])
            ->withCount([
                'comments',
                'checklistItems',
                'checklistItems as checklist_items_done_count' => fn ($q) => $q->where('checklist_items.is_done', true),
            ]),
    ]),
]);
```

Detalhes que importam:

- `labels:id` / `members:id` — só o id, porque o card guarda `label_ids` e o
  objeto completo já vem em `board.labels`. Evita repetir a mesma etiqueta 40x
  no JSON.
- `checklistItems` é um `hasManyThrough` em [`Card`](app/Models/Card.php)
  só para permitir `withCount` sem carregar as checklists.
- `cards.board_id` é **desnormalizado de propósito**: autorização e filtros por
  quadro não precisam de join com `board_lists`.

### 2.5 Ordenação: o cliente manda a ordem final

Reordenar por "índice + 1" gera corrida e drift. A abordagem aqui é
**idempotente**: depois de um arraste, o cliente envia a lista completa de ids
na ordem final, e o servidor materializa.

```php
// CardController::move
foreach ($validated['ordered_ids'] as $index => $id) {
    if (in_array((int) $id, $allowed, true)) {
        Card::query()->whereKey($id)->update(['position' => $index + 1]);
    }
}
```

`$allowed` é a interseção com os cards que realmente estão naquela lista — ids
forjados são ignorados silenciosamente, e o `Rule::exists(...)->where('board_id', ...)`
barra mover um card para o quadro de outra pessoa.

A coluna `position` é `double` para permitir migrar depois para posicionamento
fracionário (média entre vizinhos) sem mudar o schema, se um dia a
concorrência justificar.

### 2.6 Transações onde a operação é composta

Criar um quadro cria quadro + membro + 4 etiquetas + 3 listas. Ou tudo, ou
nada:

```php
$board = DB::transaction(function () use (...): Board {
    ...
});
```

Mesma coisa em `DemoBoardBuilder` e no `move`.

### 2.7 Configuração em `config/`, nunca hardcoded

Cores, fundos e limites vivem em [`config/taskon.php`](config/taskon.php) e são
usados tanto na validação (`Rule::in(config('taskon.colors'))`) quanto enviados
como prop para o React. **Uma fonte da verdade.**

### 2.8 Flash messages efêmeras

Use `Inertia::flash()`, não `->with('success', ...)`:

```php
Inertia::flash('toast', ['type' => 'success', 'message' => 'Quadro criado.']);
```

O flash do Inertia v3 não fica preso no histórico do navegador — voltar de
página não faz o toast reaparecer. O listener global está em
[`resources/js/app.tsx`](resources/js/app.tsx).

---

## 3. Frontend

### 3.1 Tipos são o contrato, não decoração

Todo prop de página é tipado. `resources/js/types/index.d.ts` também estende os
tipos do Inertia para que `usePage().props.auth.user` seja tipado em qualquer
componente, sem generics repetidos:

```ts
declare module '@inertiajs/core' {
    interface InertiaConfig {
        sharedPageProps: SharedProps;
        flashDataType: { toast?: Toast };
    }
}
```

Rode `npm run types` antes de commitar. É rápido e pega quase todo desencontro
entre backend e frontend.

### 3.2 Estado do servidor mora no servidor

A regra padrão é: **não copie props para o `useState`**. Renderize direto de
`props` e deixe o Inertia recarregar após cada mutação.

A única exceção é o arraste, em [`pages/boards/show.tsx`](resources/js/pages/boards/show.tsx):
durante o gesto a UI precisa responder no mesmo frame, então existe um espelho
local que volta a ser sobrescrito pelo servidor assim que a resposta chega.

```tsx
const [lists, setLists] = useState(board.lists);

useEffect(() => {
    if (!isDragging.current) setLists(board.lists);   // servidor manda de novo
}, [board.lists]);
```

O `isDragging.current` evita que uma resposta chegando no meio do gesto puxe o
card de volta da mão do usuário.

### 3.3 Recarregue só o que mudou

Toda mutação usa `only`, `preserveScroll` e `preserveState`:

```tsx
router.patch(url, data, {
    preserveScroll: true,   // não pula para o topo
    preserveState: true,    // não perde o formulário aberto / a coluna rolada
    only: ['board'],        // o servidor só re-serializa esse prop
});
```

Dentro do card, `only: ['board', 'activeCard']`. O feed de atividades usa
`Inertia::defer()` — o quadro pinta primeiro, o histórico entra depois.

### 3.4 Deep link em vez de estado de modal

O card aberto é uma rota (`/boards/1/cards/42`), não um `useState`. Consequências
de graça: F5 reabre o card, o botão Voltar fecha, o link é compartilhável.

```tsx
const openCard = (card) =>
    router.get(`/boards/${board.id}/cards/${card.id}`, {}, {
        preserveState: true, preserveScroll: true, only: ['activeCard'],
    });
```

### 3.5 Formulários com `useForm`

`useForm` cuida de `processing`, `errors`, `recentlySuccessful` e reset.
Nunca monte `fetch` na mão nem trate erro de validação manualmente:

```tsx
const form = useForm({ email: '', password: '' });

form.post('/login', { onFinish: () => form.reset('password') });
```

### 3.6 Componentes: primitivo não conhece domínio

`components/ui/*` não importa nada de `@/types` relacionado a quadro. Se um
botão precisar saber o que é um card, ele não pertence a `ui/`.

Componentes de domínio recebem dados por prop e disparam mutações via `router`.
Não existe store global — o servidor é o store.

---

## 4. Interface, animação e acessibilidade

### 4.1 Tokens, não cores soltas

Toda cor vem de uma variável CSS em [`resources/css/app.css`](resources/css/app.css)
e é exposta como utilitário Tailwind via `@theme inline`:

```css
:root  { --surface: oklch(100% 0 0); }
.dark  { --surface: oklch(21.5% 0.022 267); }

@theme inline { --color-surface: var(--surface); }
```

Use `bg-surface`, `text-muted-fg`, `ring-border`. **Não** use `bg-white
dark:bg-slate-800` espalhado — trocar o tema viraria caça ao tesouro.

Exceção consciente: cores de etiqueta e capa são um mapa estático em
[`lib/palette.ts`](resources/js/lib/palette.ts), porque o Tailwind só gera a
classe que enxerga escrita por extenso. `` `bg-${color}-500` `` **não funciona**.

### 4.2 Anime transform e opacity. Só.

`transform` e `opacity` rodam na GPU sem recalcular layout. Animar `width`,
`top` ou `height` força reflow a 60fps e o quadro engasga.

Exceção onde vale a pena: a barra de progresso da checklist usa `motion` para
animar `width`, mas é um elemento pequeno e isolado.

### 4.3 Feedback de clique

Todo botão em [`components/ui/button.tsx`](resources/js/components/ui/button.tsx)
tem duas camadas de resposta tátil:

1. `active:scale-[0.97]` — a "afundada", em CSS puro, custo zero.
2. Ripple nascendo na coordenada exata do ponteiro
   ([`use-ripple.tsx`](resources/js/hooks/use-ripple.tsx)), limpo no
   `onAnimationEnd` — sem `setTimeout` pendurado.

### 4.4 `prefers-reduced-motion` não é opcional

Existe um bloco global no fim do `app.css` que zera durações, e o
`useRipple`/`useReveal` checam a media query antes de agendar qualquer coisa.
Movimento é enfeite; para parte dos usuários é enjoo.

### 4.5 Revelação no scroll com IntersectionObserver

Nunca com `addEventListener('scroll')` + `getBoundingClientRect()`: isso força
layout a cada frame. O hook [`use-reveal.ts`](resources/js/hooks/use-reveal.ts)
observa uma vez e desconecta o alvo assim que ele aparece.

Parallax é a exceção legítima: `useScroll` do `motion` usa scroll timeline e
`transform`, sem tocar em layout.

### 4.6 Acessibilidade mínima obrigatória

- Todo botão só de ícone tem `aria-label`.
- Modais: `role="dialog"`, `aria-modal`, fecham no `Esc`, travam o scroll do
  fundo sem "pular" o layout (compensam a largura da barra de rolagem).
- Drag and drop tem `KeyboardSensor`: Tab até o card, Espaço pega, setas movem.
- Nada de `window.confirm()` para ações destrutivas — ele trava a thread e
  quebra a continuidade visual. Use [`useConfirm`](resources/js/components/ui/confirm.tsx).
- `:focus-visible` sempre visível; não remova outline sem colocar outro.

---

## 5. Drag and drop

Escolha: **@dnd-kit**, não `react-beautiful-dnd` (sem manutenção e incompatível
com React 19).

Três coisas resolvem 90% dos problemas de um Kanban:

**1. Colisão filtrada por tipo.** Colunas e cards vivem no mesmo `DndContext`.
Sem filtrar, um card "gruda" na coluna e vice-versa:

```tsx
const collisionDetection = (args) => {
    const type = args.active.data.current?.type;
    return closestCorners({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) =>
            type === 'list' ? c.data.current?.type === 'list' : c.data.current?.type !== 'list',
        ),
    });
};
```

**2. Zona de soltura própria por coluna.** O `useSortable` da coluna não cobre
o corpo vazio. Um `useDroppable` com id `dropzone:{id}` é o que permite largar
um card numa lista sem nenhum card.

**3. Movimento entre colunas no `onDragOver`, não no `onDragEnd`.** Assim o card
já aparece na coluna de destino enquanto o dedo ainda está pressionado.

Cuidados menores que dão trabalho quando faltam:

- Distinguir clique de arraste: `activationConstraint: { distance: 6 }` no
  mouse, e no `onClick` do card uma checagem de quanto o ponteiro andou.
- Ao espalhar `{...listeners}`, **encadeie** seu `onPointerDown` em vez de
  sobrescrever — o spread vem antes, o seu handler depois, e o do dnd-kit some.
- No toque, `activationConstraint: { delay: 200 }` + `touch-manipulation`:
  segurar arrasta, deslizar rola a coluna.

---

## 6. Performance

- **Code splitting por página**: `import.meta.glob` em `app.tsx` gera um chunk
  por página. A tela de login não baixa o dnd-kit.
- **`Vite::prefetch`** no `AppServiceProvider` baixa os chunks das próximas
  páginas depois que a atual carrega.
- **`<Link prefetch="hover" cacheFor="30s">`** nos cards do dashboard: quando o
  clique acontece, a resposta já está em cache.
- **`useMemo` só onde há custo real** — a filtragem de cards em
  `boards/show.tsx` roda a cada render de arraste. Em botão, não use.
- **`showProgress: false`** nos requests de reordenação: a barra de progresso
  piscando a cada arraste é ruído visual, não informação.

---

## 7. Segurança

- Sessão + cookie `HttpOnly`, CSRF do Laravel. Nenhum token em `localStorage`.
- `password` com cast `hashed` no model — nunca `Hash::make` espalhado.
- Rate limit em login (`throttle:10,1` + 5 tentativas por e-mail+IP no
  [`LoginRequest`](app/Http/Requests/Auth/LoginRequest.php)) e em troca de senha.
- Mass assignment: `#[Fillable([...])]` em todo model, com a lista mínima.
  `user_id`, `board_id` e `position` são atribuídos explicitamente no código,
  nunca pelo request.
- Toda rota autenticada passa por `authorize()`. Não confie em esconder o botão.
- Cookie `appearance` é o único fora da criptografia (o JS precisa lê-lo) e não
  carrega nada sensível.

---

## 8. Testes

```bash
php artisan test
```

O que **precisa** de teste:

1. **Autorização** — quem não é membro recebe 403; membro comum não muda
   configuração; só o dono exclui o quadro.
2. **Escopo de dados** — o dashboard só lista quadros do usuário; etiqueta de
   outro quadro dá 404; card não migra entre quadros.
3. **Ordenação** — mover card e reordenar listas realmente persistem, e ids de
   fora são ignorados.
4. **Formato do payload** — os contadores que o card exibe (`checklist_total`,
   `comments_count`) chegam preenchidos. Use `assertInertia`:

```php
$this->get("/boards/{$board->id}")
    ->assertInertia(fn ($page) => $page
        ->component('boards/show')
        ->where('board.lists.0.cards.0.checklist_total', 2)
        ->etc());
```

O que **não** precisa: getters, relações triviais, componente React que só
renderiza prop.

Os testes rodam contra o banco `taskon_test` (ver `phpunit.xml`) com
`RefreshDatabase`. Não aponte para o banco de desenvolvimento.

---

## 9. Convenções

**PHP** — PSR-12 via Pint. Rode antes de commitar:

```bash
./vendor/bin/pint
```

- Tipagem em tudo: parâmetros, retornos, propriedades.
- `snake_case` em colunas, `camelCase` em métodos, `PascalCase` em classes.
- Docblock só quando acrescenta (`@return HasMany<Card, $this>`); não repita a
  assinatura em português.

**TypeScript/React**

- Componente: `PascalCase`. Arquivo: `kebab-case.tsx`.
- Sem `default export` em componentes de `components/` (só em `pages/` e
  `layouts/`, porque o Inertia resolve por default).
- Sem `any`. Se precisou, o tipo do backend está errado.
- Importe com `@/`, nunca `../../..`.

**Comentários** — explicam **por que**, nunca **o que**. Comentário que
descreve a linha de baixo é ruído; comentário que explica a decisão evita que
alguém "conserte" o código e quebre algo.

**Commits** — um assunto por commit. Se mexeu no Resource, mexa no tipo TS no
mesmo commit.

---

## 10. O que ficou de fora (e como fazer)

| Item | Caminho |
| --- | --- |
| Tempo real (ver o card do colega mover) | Laravel Reverb + `Echo.private('board.{id}')`, aplicando o evento no espelho local em `boards/show.tsx`. |
| Anexos em cards | `Storage` no disco `public` + `php artisan storage:link`, tabela `attachments` polimórfica. |
| Arquivar em vez de excluir | As colunas `archived_at` já existem em `boards`, `board_lists` e `cards`; falta a UI e um filtro "ver arquivados". |
| Markdown na descrição | Renderizar no cliente com sanitização; **nunca** `dangerouslySetInnerHTML` sem sanitizar. |
| Busca global entre quadros | Índice `FULLTEXT` em `cards.title` + rota `/search` com `Inertia::defer`. |
| Notificação por e-mail em menção | Fila (`QUEUE_CONNECTION=database`) + `php artisan queue:work`. |

Ao pegar um destes: comece pela migration, depois model, policy, controller,
resource, tipo TS e só então o componente. Nessa ordem o TypeScript te guia.
