<p align="center">
  <img src="public/favicon.svg" width="72" alt="Taskon">
</p>

<h1 align="center">Taskon</h1>

<p align="center">
  Um clone do Trello para rodar na sua máquina.<br>
  Laravel 13 · Inertia v3 · React 19 · TypeScript · Tailwind v4 · dnd-kit
</p>

---

## O que tem aqui

- **Painel** com gráficos animados: ritmo de 14 dias, anel de prazos, progresso
  por quadro, próximos vencimentos e feed de atividade.
- **Quadros** com 8 fundos em gradiente, favoritos e membros com papéis
  (dono / admin / membro).
- **Listas e cards** com arrastar e soltar de verdade — entre colunas,
  reordenando colunas, com auto-scroll nas bordas e suporte a teclado.
  A coluna marcada com ✓ conclui o card que receber (e reabre o que sair).
- **Cards completos**: descrição, etiquetas coloridas, responsáveis, prazo com
  destaque de atraso, capa colorida, checklists com barra de progresso,
  comentários e histórico.
- **Filtros** por texto, etiqueta, responsável, "só os meus" e "esconder
  concluídos".
- **Exportar como prompt**: entra no modo seleção, você marca os cards e sai um
  texto separado em sprints — por lista, por prazo, em blocos de N ou montado na
  mão — em Markdown, texto puro ou JSON, pronto para colar num LLM.
- **Feed de atividades** do quadro, carregado depois da primeira pintura.
- **Resumo diário por e-mail** com o que venceu, o que vence hoje e o que vem
  nos próximos dias — entregue pelo Resend, com opt-out em
  `/settings/notificações`.
- **Autenticação** completa: cadastro, login com rate limit, recuperação de
  senha, troca de senha, perfil com cor de avatar e exclusão de conta.
- **Tema claro/escuro/sistema** sem flash no primeiro carregamento.
- Deep link para card (`/boards/1/cards/42`): F5 reabre, Voltar fecha.

---

## Rodando com Docker — https://tasks.localhost

Este é o caminho principal. O app roda atrás do **Traefik** da infra local e usa
os serviços **compartilhados** dela: o MariaDB (`mariadb`) e o Mailpit
(`mailpit`). Nenhum banco ou caixa de e-mail sobe junto com o projeto, e nenhuma
porta é publicada no host — quem expõe é o proxy.

### Pré-requisitos (uma vez)

**1. A infra no ar** — na pasta do `servidor-docker-traefik`:

```bash
docker network create web     # se ainda não existir
docker compose up -d
```

**2. O banco criado** no MariaDB central:

```bash
docker exec -i mariadb mariadb -uroot -proot -e \
  "CREATE DATABASE IF NOT EXISTS \`taskon\`      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE DATABASE IF NOT EXISTS \`taskon_test\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

**3. O certificado cobrindo o domínio** — `tasks.localhost` já foi acrescentado
à lista `$Dominios` do `gerar-certificados.ps1` da infra, mas o script precisa
rodar para o certificado ser reemitido:

```powershell
.\gerar-certificados.ps1      # na pasta da infra; reinicia o Traefik
```

Depois **feche o navegador por completo** e reabra — F5 não basta, o Chrome só
relê o repositório de certificados ao iniciar. Sem esse passo o site abre, mas
com aviso de certificado inválido.

**4. Os assets buildados** (o nginx serve `public/build` direto do disco):

```bash
npm install
npm run build
```

### Subir

```bash
docker compose up -d
```

Na primeira vez o serviço `taskon-init` roda `composer install`, `migrate` e o
seed — acompanhe com `docker compose logs -f taskon-init`. Quando ele terminar,
abra **https://tasks.localhost**.

### Como está montado

| Container | Papel |
| --- | --- |
| `taskon-init` | Roda uma vez: composer, migrations, seed. Idempotente. |
| `taskon-app` | PHP-FPM 8.3. Só ele fala com o banco. |
| `taskon-scheduler` | `schedule:work`. É quem dispara o resumo diário — sem ele nada sai sozinho. |
| `taskon-nginx` | Serve `public/` e repassa PHP ao `taskon-app`. É quem tem as labels do Traefik. |

O código é **bind mount** do Windows: editar um `.php` reflete na hora (o
opcache revalida a cada 2 s). O `vendor/` é a exceção — mora num volume do
Docker, por performance, e é **separado** do `vendor/` do Windows que a IDE
enxerga. Mudou `composer.json`? Rode `docker compose exec taskon-app composer install`.

### Comandos do dia a dia

```bash
docker compose exec taskon-app php artisan <comando>
docker compose exec taskon-app php artisan test
docker compose exec taskon-app composer install
docker compose logs -f taskon-app          # ou https://logs.localhost (Dozzle)
docker compose restart taskon-app          # depois de mexer em .env
docker compose down                        # derruba só este projeto
```

Mudou algo em `public/build`? Rode `npm run build` **no host** — não existe Node
dentro dos containers. Para hot reload, use o modo sem Docker abaixo.

---

## Rodando sem Docker

Útil para hot reload do Vite, que atrás do HTTPS do proxy seria bloqueado como
*mixed content*. Aponta para o **mesmo banco e o mesmo Mailpit** — a infra
publica o MariaDB em `127.0.0.1:3309` e o SMTP do Mailpit em `127.0.0.1:1025`
justamente para clientes de fora do Docker.

| | Versão usada aqui |
| --- | --- |
| PHP | 8.3 (com `pdo_mysql`) |
| Composer | 2.8 |
| Node | 22 |

```bash
composer install
npm install
cp .env.example .env          # já vem apontando para 127.0.0.1:3309
php artisan key:generate

php artisan serve             # http://localhost:8000
npm run dev                   # Vite com hot reload
```

Ou `composer dev`, que sobe servidor, fila e Vite juntos.

> Os dois modos compartilham o banco. O que muda é só o endereço: dentro do
> container é `mariadb:3306`, fora é `127.0.0.1:3309`. Como o Dotenv do Laravel é
> imutável, a variável de ambiente que o compose injeta vence o `.env` — por isso
> o mesmo arquivo serve para os dois.

### Contas de demonstração

| E-mail | Senha | Papel |
| --- | --- | --- |
| `victor@taskon.test` | `password` | dono de 2 quadros |
| `ana@taskon.test` | `password` | admin em 1 quadro compartilhado |

Contas novas criadas pelo `/register` já nascem com um quadro de exemplo
preenchido — nada de tela vazia.

---

## Comandos

```bash
php artisan test          # suíte de testes (roda no banco taskon_test)
npm run types             # checagem de tipos do TypeScript
npm run build             # build de produção
./vendor/bin/pint         # formatação do PHP
php artisan migrate:fresh --seed   # zera e repovoa o banco
```

E-mails (como o link de recuperação de senha) vão para o **Mailpit central** da
infra e podem ser lidos em https://mail.localhost. Nada sai para a internet.

---

## Resumo diário por e-mail

Um e-mail por dia às **07:00** com o que passou do prazo, o que vence hoje e o
que vem nos próximos 7 dias — só as tarefas **atribuídas a você**. Quem não tem
nada no radar não recebe nada: caixa de entrada limpa vale mais que constância.

Liga e desliga em **Configurações › Notificações**, que também mostra a prévia do
que o e-mail de hoje diria e tem um botão para mandar um agora.

```bash
php artisan taskon:daily-digest --dry-run     # quem receberia, sem enviar
php artisan taskon:daily-digest --user=victor@taskon.test --force
php artisan taskon:daily-digest               # o que o agendador roda
```

Quem dispara sozinho é o container `taskon-scheduler`. Fora do Docker, rode
`php artisan schedule:work` em outro terminal.

### Entregando de verdade pelo Resend

No desenvolvimento o resumo cai no Mailpit e você confere o layout em
https://mail.localhost. Para sair pela internet, no `.env`:

```dotenv
MAIL_MAILER=resend
RESEND_API_KEY=re_xxxxxxxxxxxx
MAIL_FROM_ADDRESS="taskon@seudominio.com"
```

E `docker compose up -d` de novo (o compose repassa as duas variáveis aos
containers). Um detalhe que custa tempo: enquanto o domínio não estiver
verificado no painel do Resend, a API **só** aceita `onboarding@resend.dev` como
remetente e **só** entrega para o e-mail da sua conta. Qualquer outro par
devolve 403 — o comando marca a linha com `✗` e o motivo aparece em
`storage/logs`.

> Com `MAIL_MAILER=resend` **todo** e-mail passa a ir pela API, inclusive o link
> de recuperação de senha. O Mailpit deixa de ver qualquer coisa.

> ⚠️ O `MAIL_HOST` é **`mailpit-central`**, não `mailpit`. Três containers
> respondem pelo nome `mailpit` na rede `web` (o central, o do `feedpass` e o do
> `encomendas`) e o DNS do Docker faz round-robin entre eles — o e-mail cairia na
> caixa do projeto errado. O alias exclusivo foi criado no compose da infra. Ver
> [BOAS_PRATICAS.md](BOAS_PRATICAS.md#104-️-nome-de-serviço-na-rede-web-é-global).

---

## Como o projeto está organizado

```
app/
├── Console/Commands/     # taskon:daily-digest
├── Http/Controllers/     # orquestração: autoriza → valida → persiste → redireciona
├── Http/Resources/       # contrato de saída, espelha resources/js/types
├── Mail/                 # DailyDigest (view em resources/views/mail/)
├── Models/               # Eloquent puro
├── Policies/             # BoardPolicy governa tudo que pertence a um quadro
└── Support/              # ActivityLogger, DemoBoardBuilder, TaskDigest

docker/
├── php/                  # imagem PHP-FPM 8.3 + entrypoint e init idempotentes
└── nginx/                # front do PHP-FPM, com as labels do Traefik no compose

resources/js/
├── pages/                # uma pasta por rota (nome = Inertia::render)
├── components/ui/        # primitivos sem conhecimento de domínio
├── components/board/     # Kanban: coluna, card, modal, filtros, atividade
├── components/dashboard/ # gráficos em SVG puro, sem lib de charts
├── layouts/              # casca das páginas
├── hooks/                # tema, ripple, revelação no scroll
├── lib/                  # cn(), formatação de data, paleta
└── types/                # contrato TypeScript compartilhado
```

Duas telas, dois endereços: **`/dashboard`** são os números e os gráficos,
**`/boards`** é a lista de quadros. Depois do login você cai no painel.

Rotas em [`routes/web.php`](routes/web.php) (painel e quadros),
[`routes/auth.php`](routes/auth.php) e [`routes/settings.php`](routes/settings.php).

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
de cada decisão: autorização pelo agregado, resources como contrato, eager
loading do quadro, estratégia de ordenação, tokens de tema, regras de animação
e acessibilidade, integração com a infra do Traefik (incluindo as armadilhas de
proxy e de DNS na rede compartilhada), e o que ainda falta implementar.

Leia antes de abrir um PR.
