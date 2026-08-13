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

- **Quadros** com 8 fundos em gradiente, favoritos e membros com papéis
  (dono / admin / membro).
- **Listas e cards** com arrastar e soltar de verdade — entre colunas,
  reordenando colunas, com auto-scroll nas bordas e suporte a teclado.
- **Cards completos**: descrição, etiquetas coloridas, responsáveis, prazo com
  destaque de atraso, capa colorida, checklists com barra de progresso,
  comentários e histórico.
- **Filtros** por texto, etiqueta, responsável, "só os meus" e "esconder
  concluídos".
- **Feed de atividades** do quadro, carregado depois da primeira pintura.
- **Autenticação** completa: cadastro, login com rate limit, recuperação de
  senha, troca de senha, perfil com cor de avatar e exclusão de conta.
- **Tema claro/escuro/sistema** sem flash no primeiro carregamento.
- Deep link para card (`/boards/1/cards/42`): F5 reabre, Voltar fecha.

---

## Rodando

### Pré-requisitos

| | Versão usada aqui |
| --- | --- |
| PHP | 8.3 (com `pdo_mysql`) |
| Composer | 2.8 |
| Node | 22 |
| MySQL | 8 em `127.0.0.1:3306` |

### Instalação

```bash
composer install
npm install

cp .env.example .env
php artisan key:generate
```

Ajuste as credenciais no `.env` e crie os bancos:

```env
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=taskon
DB_USERNAME=root
DB_PASSWORD=sua-senha
```

```sql
CREATE DATABASE taskon      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE taskon_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

```bash
php artisan migrate --seed
```

### Desenvolvimento

Dois terminais:

```bash
php artisan serve      # http://localhost:8000
npm run dev            # Vite com hot reload
```

Ou, se preferir, `composer dev` sobe servidor, fila e Vite juntos.

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

E-mails (como o link de recuperação de senha) usam o driver `log` em
desenvolvimento: o conteúdo aparece em `storage/logs/laravel.log`.

---

## Como o projeto está organizado

```
app/
├── Http/Controllers/     # orquestração: autoriza → valida → persiste → redireciona
├── Http/Resources/       # contrato de saída, espelha resources/js/types
├── Models/               # Eloquent puro
├── Policies/             # BoardPolicy governa tudo que pertence a um quadro
└── Support/              # ActivityLogger, DemoBoardBuilder

resources/js/
├── pages/                # uma pasta por rota (nome = Inertia::render)
├── components/ui/        # primitivos sem conhecimento de domínio
├── components/board/     # Kanban: coluna, card, modal, filtros, atividade
├── layouts/              # casca das páginas
├── hooks/                # tema, ripple, revelação no scroll
├── lib/                  # cn(), formatação de data, paleta
└── types/                # contrato TypeScript compartilhado
```

Rotas em [`routes/web.php`](routes/web.php) (quadros),
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
e acessibilidade, e o que ainda falta implementar.

Leia antes de abrir um PR.
