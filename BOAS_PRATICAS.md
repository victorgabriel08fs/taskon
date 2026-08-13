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
| `app/Support` | Serviços sem estado ([`ActivityLogger`](app/Support/ActivityLogger.php), [`DemoBoardBuilder`](app/Support/DemoBoardBuilder.php), [`TaskDigest`](app/Support/TaskDigest.php)). |
| `app/Console/Commands` | Tarefas de linha de comando e agendadas. Ver a seção 11. |
| `app/Mail` | Mailables. A view de cada um em `resources/views/mail/`. |
| `resources/js/pages` | Uma pasta por rota. O nome do arquivo é o `Inertia::render()`. |
| `resources/js/components/ui` | Primitivos reutilizáveis, sem conhecer o domínio. |
| `resources/js/components/board` | Componentes que sabem o que é card, lista, etiqueta. |
| `resources/js/components/dashboard` | Gráficos em SVG puro e cartões de número. Ver a seção 12. |
| `resources/js/layouts` | Casca das páginas (cabeçalho, navegação, painel de auth). |
| `docker/` | Imagem PHP-FPM, nginx e scripts de boot. Ver a seção 10. |

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

Os testes rodam contra o banco `taskon_test` com `RefreshDatabase`.

⚠️ **Quem garante isso é [`tests/bootstrap.php`](tests/bootstrap.php), não o
`phpunit.xml`.** Dentro do container o compose exporta `DB_DATABASE=taskon` como
variável de ambiente de verdade, e o bloco `<php>` do PHPUnit — mesmo com
`force="true"` — só sobrescreve `putenv()` e `$_ENV`. O `$_SERVER` continua com o
valor do Docker, e é dele que o `env()` do Laravel lê primeiro:

```
env(DB_DATABASE)='taskon'   getenv='taskon_test'   $_ENV='taskon_test'   $_SERVER='taskon'
```

Sem o bootstrap, `docker compose exec taskon-app php artisan test` apagava o
banco de desenvolvimento — em silêncio, com a suíte passando. Ao acrescentar uma
variável nova ao `docker-compose.yml`, veja se ela precisa entrar na lista de lá.

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

## 10. Integração com a infra do Traefik

O app roda atrás do proxy local e usa os serviços compartilhados da infra. As
regras abaixo não são preferência: cada uma corresponde a um jeito específico de
quebrar.

### 10.1 Nenhuma porta publicada, nenhum `entrypoints`

`docker-compose.yml` não tem `ports:`. Quem expõe é o Traefik, pelas labels do
`taskon-nginx`. E o router **não declara `entrypoints`** — sem essa label ele se
liga a todos, então o app responde em `http://` e `https://` ao mesmo tempo.
Escrever `entrypoints=web` o prenderia à porta 80 e ele sumiria em HTTPS com
"404 page not found".

O TLS vem do entrypoint (`traefik.yml` da infra), então também não existe
`tls=true` aqui.

### 10.2 TrustProxies **e** APP_URL — os dois

O TLS termina no proxy; o container recebe HTTP puro. Sem `trustProxies` em
[`bootstrap/app.php`](bootstrap/app.php), o Laravel gera link `http://` dentro de
página `https://` e o navegador bloqueia CSS/JS como *mixed content*. O sintoma é
"a página abriu sem estilo", que parece erro de build e não é.

Os dois consertam coisas diferentes:

- **`trustProxies`** → URLs geradas **durante** um request (o `X-Forwarded-Proto`).
- **`APP_URL`** → URLs geradas **sem** request: fila, e-mail, `artisan`, link de
  recuperação de senha.

### 10.3 `SESSION_SECURE_COOKIE` fica `false` — por enquanto

O redirect global HTTP→HTTPS da infra (FASE 2 no `traefik.yml`) está desligado,
então `http://tasks.localhost` continua respondendo. Com o cookie marcado como
`Secure`, um acesso por `http://` perde a sessão **em silêncio** — o login volta
para a tela de login sem erro nenhum, e você procura o bug no lugar errado.
Ligue junto com a FASE 2, não antes.

### 10.4 ⚠️ Nome de serviço na rede `web` é global

Este é o mais traiçoeiro, e custou um e-mail perdido para descobrir.

A rede `web` é compartilhada por **todos** os projetos. Cada container recebe,
como alias de DNS, o nome do seu serviço no compose. Quando dois projetos
distintos têm um serviço com o mesmo nome na `web`, o DNS do Docker devolve
**todos** os IPs e faz round-robin — a conexão vai para um container aleatório,
sem erro nenhum.

Foi exatamente o que aconteceu ao enviar o e-mail de recuperação de senha:

```
$ getent hosts mailpit          # de dentro do taskon-app
172.18.0.10   mailpit           # feedpass-mailpit-1
172.18.0.3    mailpit           # o central da infra
172.18.0.15   mailpit           # feedpass-encomendas-mailpit-1
```

O e-mail foi parar na caixa do `encomendas`. O `mariadb` não tem esse problema
porque só existe um na `web` (os bancos dos outros projetos vivem em redes
privadas).

**Como ficou resolvido.** O compose da infra passou a dar ao Mailpit central um
alias exclusivo, e é para ele que este projeto aponta:

```yaml
# servidor-docker-traefik/docker-compose.yml
mailpit:
  networks:
    web:
      aliases:
        - mailpit-central     # nome que só este container atende
```

```yaml
# docker-compose.yml (aqui)
MAIL_HOST: mailpit-central
```

O nome `mailpit` continua ambíguo — os outros apps podem migrar quando quiserem.

Duas consequências práticas para qualquer projeto novo na `web`:

1. **Nomeie os serviços com prefixo do projeto** — `taskon-app`, `taskon-nginx`,
   e não `app`/`nginx`. O `feedpass-nginx-1` já ocupa o alias `nginx` na `web`.
2. **Antes de depender de um nome da infra**, confira quantos IPs ele resolve.
   Mais de uma linha = ambiguidade:

```bash
docker compose exec taskon-app getent hosts mailpit-central
# 172.18.0.3   mailpit-central          <- um só: pode confiar
```

### 10.5 `vendor/` em volume, código em bind mount

O código vem por bind mount do Windows, onde cada `stat()` custa alguns
milissegundos e uma request toca centenas de arquivos. O `vendor/` — a maior
parte deles — mora num **volume do Docker**, em disco Linux.

O preço: são dois `vendor/` diferentes. O do volume serve o container; o do
Windows serve a IDE e o `artisan` rodando fora do Docker. Mudou
`composer.json`? Rode nos dois.

### 10.6 Caches do Laravel são veneno com bind mount

`config:cache` rodado no **host** congela `DB_HOST=127.0.0.1` dentro de
`bootstrap/cache/` — que é bind mount. O container leria esse arquivo e ignoraria
o `DB_HOST=mariadb` que o compose injeta. Por isso o
[`init.sh`](docker/php/init.sh) roda `optimize:clear` **sempre**, e não só na
primeira vez.

### 10.7 `init.sh` precisa ser idempotente

Ele roda em todo `docker compose up`. `migrate` já é idempotente; o `db:seed`
**não é** (e-mail é único), então só executa quando não há nenhum usuário — ou
seja, banco realmente novo.

---

## 11. E-mail: o resumo diário

`taskon:daily-digest` manda, uma vez por dia, o que está vencido e o que vence
em seguida. As peças: [`TaskDigest`](app/Support/TaskDigest.php) (os dados),
[`DailyDigest`](app/Mail/DailyDigest.php) (o e-mail),
[`SendDailyDigest`](app/Console/Commands/SendDailyDigest.php) (o disparo) e o
agendamento em [`routes/console.php`](routes/console.php).

### 11.1 ⚠️ O fuso do app deixou de ser UTC

Este é o detalhe que faz o resumo funcionar — ou mentir.

O `<input type="datetime-local">` do prazo manda uma data **sem fuso**
(`"2026-08-13T09:00"`) e o Laravel a interpreta em `config('app.timezone')`.
Com `UTC` ali, escolher 09:00 gravava `09:00Z`, e a interface — que converte de
volta para o horário do navegador — devolvia **06:00**. Três horas a menos, sem
erro nenhum, desde sempre.

O resumo diário herdaria o mesmo desalinhamento em dose dupla: `now()` em UTC
faz "hoje" começar às 21:00 do dia anterior, então das 21:00 à meia-noite todo
card de amanhã aparecia como "vence hoje".

`config/app.php` agora usa `env('APP_TIMEZONE', 'America/Sao_Paulo')`. Se um dia
o app for para um servidor de verdade, com gente em fusos diferentes, a saída
não é voltar para UTC no config — é guardar o fuso **por usuário** e converter na
borda (formulário e e-mail), mantendo o banco em UTC.

### 11.2 Só cards atribuídos, e só de quadros vivos

```php
Card::query()
    ->whereNull('cards.archived_at')
    ->whereHas('members', fn ($q) => $q->whereKey($user->getKey()))
    ->whereHas('board', fn ($q) => $q
        ->whereNull('boards.archived_at')
        ->whereHas('members', fn ($q) => $q->whereKey($user->getKey())))
```

O segundo `whereHas` parece redundante e não é: sair de um quadro **não** apaga
as atribuições de card. Sem ele, quem foi removido do quadro continuaria
recebendo lembretes de tarefas que já nem consegue abrir — vazamento de dado
por e-mail, o pior lugar para vazar, porque fica no histórico de quem recebeu.

Autorização em consulta de fila é a mesma regra da seção 2.2: não existe
`$request->user()` para a policy conferir, então o filtro tem que estar no
`WHERE`.

### 11.3 O carimbo é a trava contra o envio duplo

`users.digest_last_sent_at` guarda o último envio bem-sucedido. O comando pula
quem já recebeu hoje. Sem isso, um `docker compose restart` no horário errado,
um retry manual ou dois agendadores de pé mandariam o mesmo e-mail duas vezes —
e a segunda cópia treina a pessoa a ignorar a primeira.

Regras que caem junto:

- **`--force`** fura a trava e o opt-out. É a válvula para teste manual.
- **O botão "enviar agora" das configurações NÃO carimba.** Testar não pode
  consumir o envio real do dia.
- **Falha de um endereço não derruba o lote.** O `try/catch` por usuário deixa o
  carimbo intacto, então a próxima rodada tenta de novo.

### 11.4 Não mandar é uma feature

`skip_when_empty` corta o envio de quem não tem nada vencido, nada no horizonte
e nada concluído nas últimas 24 h. Um resumo diário que chega vazio todo dia
vira ruído em duas semanas, e aí o dia em que ele traz algo urgente também é
ignorado. A tela de configurações mostra a prévia do que sairia hoje,
inclusive quando a resposta é "nada — o envio seria pulado".

### 11.5 HTML de e-mail é HTML de 2005

[`resources/views/mail/daily-digest.blade.php`](resources/views/mail/daily-digest.blade.php)
usa tabela, largura fixa e estilo inline porque cliente de e-mail descarta
`<style>` externo, flexbox e grid. Regras aplicadas ali:

- Gradiente **sempre** com `background-color` sólido antes do
  `background-image` — o Outlook ignora o gradiente e ficaria texto branco no
  branco.
- Faixa colorida da lateral é um `<td width="4">`, não `border-left`.
- Nenhuma imagem remota: quase todo cliente bloqueia por padrão, e um layout
  que depende de imagem chega quebrado.
- Cabeçalho `List-Unsubscribe` — sem ele, quem quer sair marca como spam, e isso
  queima a reputação do domínio no Resend.

### 11.6 Mailpit no desenvolvimento, Resend na entrega

`MAIL_MAILER=smtp` entrega no Mailpit central e nada sai da máquina — é o
default e é onde se olha o layout. `MAIL_MAILER=resend` + `RESEND_API_KEY`
entrega de verdade pela API; aí o Mailpit deixa de ver qualquer coisa.

Enquanto o domínio não estiver verificado no painel do Resend, a API só aceita
`onboarding@resend.dev` como remetente e só entrega para o e-mail da conta.
Errar isso dá 403 na hora do envio, não silêncio — o comando marca a linha com
`✗` e registra no log.

### 11.7 Quem chama o agendador

O Laravel não tem relógio. `taskon-scheduler` roda `php artisan schedule:work`,
um laço que acorda a cada minuto. Em servidor de verdade seria um cron chamando
`schedule:run` — aqui o objetivo é subir tudo com um `docker compose up`.

O e-mail é enviado **síncrono**, sem fila: seria preciso um worker de pé só para
isso. Se o volume crescer, `DailyDigest implements ShouldQueue` e o serviço
`taskon-queue` já comentado no `docker-compose.yml`.

---

## 12. Painel: gráficos sem biblioteca

[`DashboardController`](app/Http/Controllers/DashboardController.php) alimenta
[`pages/dashboard.tsx`](resources/js/pages/dashboard.tsx), e os gráficos vivem em
[`components/dashboard/`](resources/js/components/dashboard/).

### 12.1 Duas escalas, ditas em voz alta

O painel mistura dois recortes, e cada bloco diz qual está usando:

| Bloco | Escala |
| --- | --- |
| Cartões do topo, anel de prazos, próximos prazos | **Suas tarefas** — só cards atribuídos (`Card::assignedTo`) |
| Ritmo, progresso por quadro, atividade | **Seus quadros** — tudo, inclusive o trabalho dos colegas |

Sem essa distinção o número não significa nada: "12 tarefas abertas" é uma coisa
se são suas e outra se é o quadro inteiro do time.

O `scopeAssignedTo` mora no model, não em cada consulta, porque é a **mesma**
definição que o resumo diário usa. Se as duas divergirem, o e-mail passa a
mentir sobre a tela — e ninguém confere isso até alguém reclamar.

### 12.2 Agregue no banco, não no navegador

Nenhuma consulta do painel traz linha que a tela não vá desenhar. `withCount`
com alias para os totais por quadro, `GROUP BY DATE(...)` para o gráfico de
ritmo. A exceção é o anel, que faz `pluck('due_at')` e separa em PHP:

```php
$dues = Card::query()->assignedTo($user)->whereNull('cards.completed_at')->pluck('due_at');
```

Uma consulta trazendo só uma coluna, em vez de cinco `COUNT`s com `CASE WHEN` —
e, de quebra, as fronteiras entre "hoje" e "próximos dias" ficam sendo
exatamente o mesmo código de comparação do `TaskDigest`, não uma tradução dele
para SQL.

Vale enquanto o volume for de centenas de cards. Passando disso, vire `SUM(CASE
WHEN ...)` — e escreva um teste que trave os números antes de mexer.

### 12.3 Dias sem movimento entram com zero

```php
return collect(range(0, self::TREND_DAYS - 1))->map(fn ($offset) => [...]);
```

O `GROUP BY` só devolve os dias em que aconteceu alguma coisa. Plotar o
resultado direto encurtaria o eixo e o domingo parado viraria uma linha reta
entre sexta e segunda — o gráfico mostraria um ritmo constante que não existiu.

### 12.4 SVG na mão, sem lib de gráfico

Nenhuma dependência nova. Os motivos, em ordem:

1. Uma lib de charts custa 50–150 kB gzip para desenhar quatro formas.
2. Tema claro/escuro em runtime: o SVG usa `var(--primary)`, `var(--danger)`
   direto no atributo `stroke`, então trocar de tema já troca o gráfico. Com
   lib, isso vira remontagem do componente com um objeto de tema.
3. As animações são as mesmas do resto do app (`motion`), com o mesmo easing.

O que isso exige em troca:

- **Curva com tangente horizontal**, não spline solto. Um Catmull-Rom passa
  acima do maior valor entre dois picos; num gráfico de contagem isso é mentira
  visual — desenha 4 onde o dado diz 3.
- **`vectorEffect="non-scaling-stroke"`** nas linhas: o `viewBox` escala com a
  largura do cartão e a espessura do traço iria junto.
- **`new Date('2026-08-13')` é UTC.** No fuso de São Paulo isso é 21:00 do dia
  12, e o rótulo do eixo mostraria o dia anterior. Todo parse de data curta no
  cliente usa `` new Date(`${date}T00:00:00`) ``.

### 12.5 Número que sobe sem re-renderizar

[`useCountUp`](resources/js/hooks/use-count-up.ts) devolve um `MotionValue`, não
um estado:

```tsx
const count = useCountUp(value);
return <motion.p>{count}</motion.p>;
```

O motion escreve direto no nó de texto. Com `useState` seriam ~55 renders do
componente por número, quatro números na tela ao mesmo tempo. Mesma ideia no
anel: o `strokeDasharray` cresce por `useMotionTemplate`, não por estado.

### 12.6 `prefers-reduced-motion` não chega ao JS

O bloco global em `app.css` zera **transição e animação CSS**. Ele não alcança
nada que o `motion` anime por JS. Onde a animação é em JS, a checagem é
explícita:

```tsx
const reduced = useReducedMotion();
if (reduced) { raw.set(value); return; }
```

Sem isso, quem pediu menos movimento ao sistema continua vendo números girando e
arcos crescendo.

### 12.7 `assertInertia` não funciona em requisição parcial

Achado ao testar a prop adiada. `AssertableInertia::fromTestResponse` faz
`assertViewHas('page')` — ele espera a **view HTML**. A requisição parcial
devolve JSON puro, e a falha aparece como um enigmático "Not a valid Inertia
response". Nesses casos, asserção em JSON mesmo:

```php
->assertJsonPath('component', 'dashboard')
->assertJsonStructure(['props' => ['activity']]);
```

E o `X-Inertia-Version` é obrigatório: sem ele a resposta é **409** e a
requisição nem chega ao controller. A versão vem do middleware —
`(new HandleInertiaRequests)->version(request())` —, porque o facade só a
conhece durante um request.

### 12.8 "Vencida" é o dia, não a hora

Um card marcado para **hoje às 10:00** continua sendo "de hoje" às 11:00. Ele só
vira vencido na virada da meia-noite.

```php
$startOfToday = $now->startOfDay();

overdue: $card->due_at->lt($startOfToday)
today:   $card->due_at->between($startOfToday, $endOfToday)
```

Comparar com `$now` cru parece mais exato e é pior de usar: a tela ficaria
vermelha no meio da manhã e o card de hoje disputaria atenção com o que está
atrasado há três dias. Quando tudo é urgente, nada é.

A regra existe **duas vezes** — em [`TaskDigest`](app/Support/TaskDigest.php) e
em [`dueState()`](resources/js/lib/utils.ts) — porque o selo do card é decidido
no cliente e o número do painel no servidor. Mexeu em uma, mexa na outra: senão
o mesmo card aparece vermelho ao lado de um contador que o chama de "hoje".

### 12.9 Coluna de conclusão: `board_lists.is_done`

Arrastar um card para uma coluna marcada com `is_done` grava `completed_at`;
tirar de lá limpa. Sem isso, "Concluído" era só um nome: o painel contava o card
como aberto e, se tivesse prazo, como vencido.

O que a regra **não** faz é igualmente importante — só o **cruzamento** da
fronteira mexe em `completed_at`:

| Movimento | `completed_at` |
| --- | --- |
| comum → conclusão | grava agora |
| conclusão → comum | limpa |
| comum → comum | não toca |
| conclusão → conclusão | não toca |

Mover entre duas colunas comuns não pode desmarcar um card que a pessoa
concluiu na caixinha do modal. A caixinha é uma decisão manual; arrastar não a
desfaz.

Marcar uma coluna já cheia como "de conclusão" alcança quem está lá dentro — o
contrário deixaria a pessoa marcando a coluna e os cards continuando abertos.
A migration faz o mesmo de uma vez para quem já tinha uma coluna chamada
"Concluído", "Done", "Feito" e afins, usando `updated_at` como aproximação de
quando o card chegou lá. Daqui para a frente quem manda é a flag, não o nome.

---

## 13. O que ficou de fora (e como fazer)

| Item | Caminho |
| --- | --- |
| Tempo real (ver o card do colega mover) | Laravel Reverb + `Echo.private('board.{id}')`, aplicando o evento no espelho local em `boards/show.tsx`. |
| Anexos em cards | `Storage` no disco `public` + `php artisan storage:link`, tabela `attachments` polimórfica. |
| Arquivar em vez de excluir | As colunas `archived_at` já existem em `boards`, `board_lists` e `cards`; falta a UI e um filtro "ver arquivados". |
| Markdown na descrição | Renderizar no cliente com sanitização; **nunca** `dangerouslySetInnerHTML` sem sanitizar. |
| Busca global entre quadros | Índice `FULLTEXT` em `cards.title` + rota `/search` com `Inertia::defer`. |
| Notificação por e-mail em menção | Fila (`QUEUE_CONNECTION=database`) + `php artisan queue:work`. |
| Horário do resumo por usuário | Coluna `digest_at` + agrupar os envios por horário no comando; hoje é um horário só, global (seção 11.1). |

Ao pegar um destes: comece pela migration, depois model, policy, controller,
resource, tipo TS e só então o componente. Nessa ordem o TypeScript te guia.
