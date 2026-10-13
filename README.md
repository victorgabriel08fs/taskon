<p align="center">
  <img src="public/favicon.svg" width="72" alt="Taskon">
</p>

<h1 align="center">Taskon</h1>

<p align="center">
  Um clone do Trello, pronto para a Vercel.<br>
  Next.js 16 · React 19 · TypeScript · Tailwind v4 · Drizzle + Postgres · dnd-kit
</p>

---

## O que tem aqui

- **Painel** com gráficos animados: ritmo de 14 dias, anel de prazos, progresso
  por quadro, próximos vencimentos e feed de atividade.
- **Quadros** com 8 fundos em gradiente, favoritos e membros com papéis
  (dono / admin / membro).
- **Convites por e-mail**: quem já tem conta entra no quadro na hora; quem
  ainda não tem recebe um link que vale 7 dias, cria a conta por ele e já cai
  dentro do quadro. Os convites pendentes aparecem na lista de membros, com
  reenviar e cancelar.
- **Listas e cards** com arrastar e soltar de verdade — entre colunas,
  reordenando colunas, com auto-scroll nas bordas e suporte a teclado.
  A coluna marcada com ✓ conclui o card que receber (e reabre o que sair).
- **Cards completos**: descrição, etiquetas coloridas, responsáveis, prazo com
  destaque de atraso, capa colorida, checklists com barra de progresso,
  comentários e histórico. Quem cria o card já entra como responsável dele.
- **Filtros** por texto, etiqueta, responsável, "só os meus" e "esconder
  concluídos".
- **Arquivamento automático dos concluídos**: cada quadro escolhe o prazo (1, 3,
  7, 14 ou 30 dias) e a coluna "Concluído" se esvazia sozinha de madrugada.
  Arquivar não apaga — os cards ficam na gaveta **Arquivados**, continuam
  contando no progresso do quadro e voltam com um clique.
- **Exportar como prompt**: entra no modo seleção, você marca os cards e sai um
  texto separado em sprints — por lista, por prazo, em blocos de N ou montado na
  mão — em Markdown, texto puro ou JSON, pronto para colar num LLM.
- **Pomodoro** no cabeçalho, ligado ao card em que você está focando.
- **Feed de atividades** do quadro, carregado depois da primeira pintura.
- **Resumo diário por e-mail** com o que venceu, o que vence hoje e o que vem
  nos próximos dias — entregue pelo Resend, com opt-out em
  `/settings/notifications`.
- **Autenticação** completa: cadastro, login com rate limit, recuperação de
  senha, troca de senha, perfil com cor de avatar e exclusão de conta.
- **Tema claro/escuro/sistema** sem flash no primeiro carregamento.
- Deep link para card (`/boards/1/cards/42`): F5 reabre, Voltar fecha.

---

## Como está montado

Um único projeto Next.js (App Router) faz as duas pontas — e é exatamente isso
que a Vercel hospeda:

```
Navegador ──► React 19 (Client Components: Kanban, modais, gráficos)
                 ▲
                 │  RSC + Server Actions (sem API REST, sem token no navegador)
                 ▼
          Next.js na Vercel ──► Server Components (páginas), Server Actions (mutações),
                 │               Route Handlers (crons, /up)
                 ▼
          Postgres (Neon ou Supabase) via Drizzle ORM
```

| Antes (Laravel) | Agora (Next.js) |
| --- | --- |
| Controllers + Form Requests | Server Actions em `src/server/actions` (`defineAction`: autentica → valida → executa → re-renderiza) |
| Regras em controllers/`app/Support` | Serviços em `src/server/services` |
| `Inertia::render` + props | Server Components em `src/app` + loaders em `src/server/queries` |
| `JsonResource` | `src/server/resources` (o mesmo formato JSON de antes, tipado em `src/types`) |
| `BoardPolicy` | `src/server/policies/board.ts` |
| Eloquent + MariaDB | Drizzle + Postgres (`src/server/db/schema.ts`, migrations em `drizzle/`) |
| Sessão do Laravel | Sessão própria por cookie HttpOnly, token em hash no banco |
| `php artisan schedule:work` | Vercel Cron (`vercel.json`) → `/api/cron/*` |
| Mailpit / Resend | `src/server/mail` (Resend em produção; SMTP/console no dev) |
| PHPUnit | Vitest + PGlite (Postgres em memória) |

---

## Rodando localmente

Pré-requisito: **Node 24**.

```bash
npm install
cp .env.example .env.local     # ajuste o que precisar
npm run db:migrate             # cria as tabelas
npm run db:seed                # contas e quadros de demonstração
npm run dev                    # http://localhost:3000
```

Sem `DATABASE_URL`, o app usa o **PGlite** — um Postgres de verdade compilado
para WebAssembly, gravando em `./.data/pglite`. Não há nada para instalar nem
container para subir. Para usar um Postgres seu (local, Neon, Supabase), basta
preencher `DATABASE_URL` no `.env.local`.

> Vindo da versão Laravel? O `.env` antigo continua na pasta (ele é ignorado
> pelo git) e o Next também o lê. Crie o `.env.local` a partir do
> `.env.example`: o que estiver nele vence o `.env`.

### Contas de demonstração (`npm run db:seed`)

| E-mail | Senha | Papel |
| --- | --- | --- |
| `victor@taskon.test` | `password` | dono de 2 quadros |
| `ana@taskon.test` | `password` | admin em 1 quadro compartilhado |

Contas novas criadas pelo `/register` já nascem com um quadro de exemplo
preenchido — nada de tela vazia.

### Comandos

```bash
npm run dev            # servidor de desenvolvimento
npm run build          # build de produção (o que a Vercel roda, sem a migração)
npm run types          # checagem de tipos (TypeScript 7)
npm run lint           # oxlint
npm test               # suíte de testes (Vitest + PGlite em memória)
npm run db:migrate     # aplica as migrations de ./drizzle
npm run db:seed        # dados de demonstração (recusa rodar em produção)
npm run db:fresh       # apaga tudo, migra e semeia (o migrate:fresh --seed)
npm run db:generate    # gera migration nova depois de mudar o schema
npm run digest -- --dry-run          # quem receberia o resumo hoje
npm run archive-done -- --dry-run    # o que a varredura arquivaria
```

E-mails no desenvolvimento: com `MAIL_MAILER=log` (o padrão sem chave do
Resend) eles são impressos no terminal; com `MAIL_MAILER=smtp` e
`MAIL_HOST=127.0.0.1`/`MAIL_PORT=1025` caem no Mailpit.

---

## Publicando na Vercel

1. **Importe o repositório** na Vercel (framework: Next.js — detectado sozinho).
2. **Conecte um Postgres.** O caminho mais curto é *Storage › Marketplace ›
   Neon*: a integração cria o banco e injeta `DATABASE_URL` (com pooler) e
   `DATABASE_URL_UNPOOLED` no projeto. Com Supabase, cadastre à mão:
   `DATABASE_URL` = string do pooler em modo *transaction* (porta 6543) e
   `DIRECT_URL` = conexão direta (porta 5432), usada só para migrar.
3. **Variáveis de ambiente** (Settings › Environment Variables):

   | Variável | Valor |
   | --- | --- |
   | `APP_TIMEZONE` | `America/Sao_Paulo` |
   | `CRON_SECRET` | uma string aleatória longa (`openssl rand -hex 32`) |
   | `RESEND_API_KEY` | a chave do Resend |
   | `MAIL_FROM_ADDRESS` | remetente de um domínio verificado no Resend |
   | `APP_URL` | opcional — sem ela, os links usam o domínio de produção da Vercel |

4. **Deploy.** O build roda `npm run vercel-build`, que aplica as migrations
   pendentes e depois faz o `next build`.
5. **Crie sua conta** pelo `/register` — o seed de demonstração não roda em
   produção (as senhas dele são públicas).

### Agendamentos

Os dois jobs que o `taskon-scheduler` rodava viraram **Vercel Cron Jobs**
(`vercel.json`, horários em UTC):

| Job | Cron (UTC) | Horário em São Paulo |
| --- | --- | --- |
| `/api/cron/daily-digest` | `0 10 * * *` | 07:00 |
| `/api/cron/archive-done-cards` | `0 6 * * *` | 03:00 |

A Vercel chama as rotas com `Authorization: Bearer $CRON_SECRET`; sem o
segredo certo elas respondem 401. No plano Hobby a Vercel garante a hora, não
o minuto — o disparo pode cair em qualquer momento daquela hora. Mudou
`DIGEST_AT`/`AUTO_ARCHIVE_AT`? Ajuste também o `schedule` no `vercel.json`.

Para disparar na mão (útil para conferir um deploy):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://seu-app.vercel.app/api/cron/daily-digest?dry-run=1"
```

### Resend

Enquanto o domínio não estiver verificado no painel do Resend, a API **só**
aceita `onboarding@resend.dev` como remetente e **só** entrega para o e-mail da
sua conta. Qualquer outro par devolve 403 — o cron registra a falha no log da
função e não carimba o envio, então a pessoa recebe no dia seguinte.

---

## Resumo diário por e-mail

Um e-mail por dia às **07:00** com o que passou do prazo, o que vence hoje e o
que vem nos próximos 7 dias — só as tarefas **atribuídas a você**. Quem não tem
nada no radar não recebe nada: caixa de entrada limpa vale mais que constância.

Liga e desliga em **Configurações › Notificações**, que também mostra a prévia do
que o e-mail de hoje diria e tem um botão para mandar um agora.

## Arquivamento automático dos concluídos

No menu **⋯ › Arquivados** de cada quadro você escolhe em quantos dias um card
concluído sai da coluna — **nunca** (o padrão), 1, 3, 7, 14 ou 30 dias. Todo dia
às **03:00** a varredura tira das colunas os concluídos que passaram do prazo.
Arquivar **não apaga**: o card continua no banco com `archived_at`, e a mesma
tela lista tudo o que está na gaveta com um botão de **Restaurar**.

- **O progresso não afunda.** Um concluído arquivado continua contando no total e
  nos concluídos do quadro, no gráfico de ritmo e em "concluídas na semana".
- **Restaurar reabre.** O card volta para a primeira coluna que não é de
  conclusão, e sem `completed_at` — senão a varredura o levaria de novo.

---

## Como o projeto está organizado

```
src/
├── app/                  # rotas (App Router): páginas, layouts, crons em api/cron
├── components/
│   ├── ui/               # primitivos sem conhecimento de domínio
│   ├── layouts/          # AppLayout, AuthLayout, SettingsLayout
│   ├── board/            # Kanban: quadro, coluna, card, modais, filtros, atividade
│   ├── boards/           # lista de quadros
│   └── dashboard/        # gráficos em SVG puro, sem lib de charts
├── hooks/                # tema, ripple, revelação no scroll, pomodoro
├── lib/                  # cn(), datas no fuso do app, paleta, exportação, actions (cliente)
├── types/                # contrato TypeScript compartilhado (os DTOs)
├── server/
│   ├── actions/          # Server Actions ('use server') + contract.ts
│   ├── services/         # regras de negócio
│   ├── queries/          # loaders das páginas
│   ├── resources/        # formato de saída (DTOs)
│   ├── policies/         # autorização pelo quadro
│   ├── auth/             # sessão, senha, rate limit
│   ├── mail/             # mailer + templates
│   └── db/               # schema Drizzle e conexão
└── proxy.ts              # redireciona visitante das telas autenticadas
drizzle/                  # migrations SQL geradas
scripts/                  # migrate, seed, fresh, digest, archive-done (o antigo artisan)
tests/                    # Vitest
```

---

## Atalhos na interface

| Onde | Tecla | O que faz |
| --- | --- | --- |
| Compositor de card | `Enter` | Salva e mantém aberto para o próximo |
| Compositor de card | `Shift + Enter` | Quebra de linha |
| Qualquer edição inline | `Esc` | Cancela sem salvar |
| Comentário | `Ctrl + Enter` | Envia |
| Card com foco | `Espaço` → setas → `Espaço` | Move sem mouse |
| Modais e popovers | `Esc` | Fecha |

---

## Documentação

**[BOAS_PRATICAS.md](BOAS_PRATICAS.md)** — as convenções do projeto e o porquê
de cada decisão. Leia antes de abrir um PR.
