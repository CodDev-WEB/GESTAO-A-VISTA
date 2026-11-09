# Gestão à Vista

Aplicação de acompanhamento de desempenho comercial com painel para TV e área administrativa protegida por autenticação Supabase.

## Funcionalidades

- Painel diário, semanal e mensal com faturamento, ticket médio, quantidade de vendas, meta e ranking.
- Pódio das três primeiras colocadas.
- Reconhecimento de boas práticas e ideias implementadas.
- Cadastro de colaboradoras e fotos.
- Metas mensais e diárias.
- Importação de vendas por Excel (.xlsx/.xls) e CSV, com prévia e validação.
- Persistência em Supabase (Postgres, Auth e Storage).

## Importação de vendas

A administração aceita os dois formatos:

### Excel
- Selecione o arquivo .xlsx ou .xls.
- O sistema procura primeiro a aba `BASE VENDAS`; se ela não existir, utiliza a primeira aba.
- Cabeçalhos reconhecidos: `Data`, `Vendedora`, `Faturamento líquido (R$)` e `Nº de vendas`.

### CSV
- Cabeçalhos obrigatórios: `data`, `vendedora`, `valor`, `vendas`.
- Cabeçalho opcional: `email`.
- O delimitador é detectado automaticamente (vírgula, ponto e vírgula ou tabulação).

### Regras de importação
- Datas: `AAAA-MM-DD` ou `DD/MM/AAAA`; datas nativas do Excel também são aceitas.
- Valores: `1250,50`, `1.250,50`, `1250.50` e valores com prefixo `R# Gestão à Vista

Aplicação de acompanhamento de desempenho comercial com painel para TV e área administrativa protegida por autenticação Supabase.

## Funcionalidades

- Painel diário, semanal e mensal com faturamento, ticket médio, quantidade de vendas, meta e ranking.
- Pódio das três primeiras colocadas.
- Reconhecimento de boas práticas e ideias implementadas.
- Cadastro de colaboradoras e fotos.
- Metas mensais e diárias.
- Importação de vendas por Excel (.xlsx/.xls) e CSV, com prévia e validação.
- Persistência em Supabase (Postgres, Auth e Storage).

## Importação de vendas

A administração aceita os dois formatos:

### Excel
- Selecione o arquivo .xlsx ou .xls.
- O sistema procura primeiro a aba `BASE VENDAS`; se ela não existir, utiliza a primeira aba.
- Cabeçalhos reconhecidos: `Data`, `Vendedora`, `Faturamento líquido (R$)` e `Nº de vendas`.

### CSV
- Cabeçalhos obrigatórios: `data`, `vendedora`, `valor`, `vendas`.
- Cabeçalho opcional: `email`.
- O delimitador é detectado automaticamente (vírgula, ponto e vírgula ou tabulação).

### Regras de importação
- Datas: `AAAA-MM-DD` ou `DD/MM/AAAA`; datas nativas do Excel também são aceitas.
; valores negativos representam estornos.
- O faturamento líquido é a soma das vendas menos estornos. O faturamento bruto e o total de estornos ficam separados para que o ticket médio considere somente vendas efetivas.
- Quantidade de vendas deve ser um número inteiro não negativo.
- A colaboradora é identificada pelo e-mail, quando informado, ou pelo nome.
- Linhas repetidas da mesma colaboradora no mesmo dia são consolidadas somando faturamento e quantidade de vendas.
- Na gravação, o registro diário existente para a mesma colaboradora é atualizado, evitando duplicidade.
- Sempre confira a prévia antes de confirmar a importação.

## Configuração do Supabase

1. No SQL Editor do Supabase, execute o arquivo completo `supabase/schema.sql`.
2. Em Authentication > Users, crie as contas de acesso.
3. Cadastre cada usuário em `public.profiles), usando o mesmo UUID de `auth.users`. Para o administrador:
   ```sql
   insert into public.profiles (id, full_name, role, active)
   select id, 'Nome do administrador', 'admin', true
   from auth.users
   where email = 'admin@seudominio.com'
   on conflict (id) do update
   set full_name = excluded.full_name,
       role = excluded.role,
       active = true;
   ```
4. Para contas da equipe, use o papel `viewer`.

A URL e a chave publicável do Supabase estão configuradas em `src/lib/supabase.ts`. A chave `sb_publishable_` pode ser usada no frontend. Nunca use `service_role` ou `sb_secret_` no navegador.

## Desenvolvimento local

Requisitos: Node.js 20 ou superior.

```bash
npm install
npm run dev
```

Para validar a aplicação:

```bash
npm run build
```

## Cloudflare Workers

O repositório inclui `wrangler.jsonc` para publicar os arquivos gerados em `dist` como assets estáticos, com fallback de Single Page Application para as rotas internas.

- Build: `npm run build`
- Deploy: `npx wrangler deploy`
- Worker: `gestao-a-vista`

Se a configuração de build do Cloudflare estiver usando Bun, `bun run build` também executa o script de build definido no `package.json`.

## Rotas

- `/`: encaminha para o acesso do painel.
- `/viewer/login`: login da equipe.
- `/viewer/board`: painel da equipe; exige perfil ativo `viewer`.
- `/admin/login`: login administrativo.
- `/admin`: administração; exige perfil ativo `admin`.

Configure a URL pública do Worker em Supabase > Authentication > URL Configuration como Site URL e Redirect URL.

## Banco de dados e segurança

O arquivo `supabase/schema.sql` cria e atualiza as tabelas `profiles`, `sellers`, `goals`, `sales_daily` e `recognitions), o bucket `seller-photos), funções auxiliares e políticas RLS. Usuários autenticados podem consultar dados operacionais; somente administradores ativos podem alterar esses dados. As fotos são públicas para leitura e restritas para gravação a administradores.
