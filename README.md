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

A administração aceita arquivos Excel e CSV.

### Excel
- Selecione um arquivo .xlsx ou .xls.
- O sistema procura primeiro a aba `BASE VENDAS`; se ela não existir, utiliza a primeira aba.
- Cabeçalhos reconhecidos: `Data`, `Vendedora`, `Faturamento líquido (R$)` e `Nº de vendas`.

### CSV
- Cabeçalhos obrigatórios: `data`, `vendedora`, `valor`, `vendas`.
- Cabeçalho opcional: `email`.
- O delimitador é detectado automaticamente (vírgula, ponto e vírgula ou tabulação).

### Regras de importação
- Datas: `AAAA-MM-DD` ou `DD/MM/AAAA`; datas nativas do Excel também são aceitas.
- Valores: `1250,50`, `1.250,50`, `1250.50` e valores com prefixo `R$` são aceitos.
- Valores negativos representam estornos e reduzem o faturamento líquido.
- O faturamento bruto e os estornos ficam separados para que o ticket médio considere somente vendas efetivas.
- A quantidade de vendas deve ser um número inteiro não negativo.
- A colaboradora é identificada pelo e-mail, quando informado, ou pelo nome.
- Linhas repetidas da mesma colaboradora no mesmo dia são consolidadas.
- Na gravação, o registro diário da mesma colaboradora é atualizado, evitando duplicidade.
- Sempre confira a prévia antes de confirmar a importação.

## Configuração do Supabase

1. No SQL Editor do Supabase, execute o arquivo completo `supabase/schema.sql`. Em instalações existentes, execute-o novamente para aplicar a migração de estornos e os campos de faturamento bruto e estornos.
2. Em Authentication > Users, crie as contas de acesso.
3. Cadastre cada usuário em `public.profiles`, usando o mesmo UUID de `auth.users`. Para o administrador:

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

A URL e a chave publicável do Supabase estão configuradas em `src/lib/supabase.ts`. A chave `sb_publishable_` é própria para uso no frontend. Nunca use `service_role` ou `sb_secret_` no navegador.

## Desenvolvimento local

Requisitos: Node.js 20 ou superior.

```bash
npm install
npm run dev
```

Para validar a aplicação:

```bash
npm run build
npm audit --audit-level=high
```

## Cloudflare Workers

O repositório inclui `wrangler.jsonc` para publicar os arquivos gerados em `dist` como assets estáticos, com fallback de Single Page Application para as rotas internas.

- Build: `npm run build`
- Deploy: `npx wrangler deploy`
- Worker: `gestao-a-vista`

A publicação no Cloudflare é uma etapa separada da validação do GitHub Actions.

## Rotas

- `/`: encaminha para o acesso do painel.
- `/viewer/login`: login da equipe.
- `/viewer/board`: painel da equipe, mediante perfil ativo.
- `/admin/login`: login administrativo.
- `/admin`: administração, mediante perfil ativo com papel `admin`.

Configure a URL pública do Worker em Supabase > Authentication > URL Configuration como Site URL e Redirect URL.

## Banco de dados e segurança

O arquivo `supabase/schema.sql` cria e atualiza as tabelas `profiles`, `sellers`, `goals`, `sales_daily` e `recognitions`, o bucket `seller-photos`, funções auxiliares e políticas RLS. Usuários autenticados podem consultar os dados operacionais; somente administradores ativos podem alterar esses dados. As fotos são públicas para leitura e restritas para gravação a administradores.

**Importante:** a execução da migração SQL no projeto Supabase é necessária para que a importação grave os campos `gross_revenue` e `refund_amount`. O build do frontend não executa essa migração no banco remoto.
