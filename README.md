# Gestão à Vista

Aplicação web para acompanhamento de desempenho comercial, com painel de visualização para TV e área administrativa protegida por autenticação independente.

## Funcionalidades
- Painel com metas, faturamento, ticket médio, vendas, pódio e ranking.
- Filtros diário, semanal e mensal.
- Mural rotativo de boas práticas e ideias implementadas.
- Administração de colaboradoras, fotos, metas e reconhecimentos.
- Importação de vendas por CSV com prévia e atualização por colaboradora/data.
- Persistência em Supabase (Postgres, Auth e Storage).

## Configuração local
1. Use Node.js 20 ou superior.
2. Execute `npm install`.
3. Copie `.env.example` para `.env.local`.
4. Preencha as variáveis:
   ```env
   VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sua_chave_sb_publishable
   ```
   A chave publicável pode estar no frontend; nunca use `service_role` ou `sb_secret_` no navegador.
5. No SQL Editor do Supabase, execute o arquivo completo `supabase/schema.sql`.
6. Em Authentication > Users, crie as contas com e-mail e senha.
7. Cadastre os perfis correspondentes na tabela `public.profiles`. Exemplo para a conta administrativa:
   ```sql
   insert into public.profiles (id, full_name, role, active)
   select id, 'Larissa', 'admin', true
   from auth.users
   where email = 'larissa@yup.com'
   on conflict (id) do update
   set full_name = excluded.full_name,
       role = excluded.role,
       active = true;
   ```
   Para colaboradoras, use o papel `viewer`.
8. Execute `npm run dev`.

## Cloudflare Pages
Configure o projeto no Cloudflare Pages com estes parâmetros:

| Configuração | Valor |
|---|---|
| Framework preset | Vite |
| Root directory | `/` (raiz do repositório) |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node.js | 20 ou superior |

Em Settings > Environment variables, cadastre **nos ambientes Production e Preview**:
- `VITE_SUPABASE_URL` = URL do projeto Supabase.
- `VITE_SUPABASE_PUBLISHABLE_KEY` = chave `sb_publishable_` do projeto.

Depois de salvar as variáveis, inicie um novo deploy (Retry deployment ou novo commit). O arquivo `public/_redirects` garante o fallback do React Router para as rotas internas, evitando erro 404 ao abrir diretamente `/admin/login` ou `/viewer/login`.

O endereço `*.pages.dev` é fornecido pelo Cloudflare após a criação do projeto e um deploy bem-sucedido; ele não é definido no código.

## Rotas
- `/`: encaminha para o acesso do painel de visualização.
- `/viewer/login`: login da equipe.
- `/viewer/board`: painel da equipe, exige perfil ativo `viewer`.
- `/admin/login`: login administrativo.
- `/admin`: administração, exige perfil ativo `admin`.

Configure em Supabase > Authentication > URL Configuration a URL publicada do Cloudflare como Site URL e inclua a URL publicada e os endereços de Preview necessários em Redirect URLs.

## Importação CSV
Cabeçalhos obrigatórios: `data`, `vendedora`, `valor`, `vendas`. Cabeçalhos opcionais: `email`, `ticket_medio`.

- Datas aceitas: `AAAA-MM-DD` ou `DD/MM/AAAA`.
- Valores aceitos: `1250,50`, `1.250,50`, `1250.50` ou com prefixo `R$`.
- A importação identifica a colaboradora pelo e-mail (quando informado) ou pelo nome.
- O banco atualiza o registro para a mesma colaboradora e data, evitando duplicidade. Se o arquivo trouxer mais de uma linha para a mesma colaboradora e data, consolide-as em uma única linha antes de importar.

## Regras de cálculo
- Diário: data selecionada.
- Semanal: segunda-feira a domingo da semana selecionada.
- Mensal: primeiro ao último dia do mês selecionado.
- Ticket médio: faturamento dividido pela quantidade de vendas.
- Progresso da meta: faturamento do mês dividido pela meta mensal.
- Estrelas não alteram o ranking financeiro.

## Segurança
O SQL aplica Row Level Security: usuários autenticados podem consultar os dados operacionais; somente administradores ativos podem inserir, alterar ou excluir dados. O painel exige perfil ativo e separa os papéis `admin` e `viewer`. O bucket de fotos é público para leitura no painel; operações de envio, atualização e exclusão exigem perfil administrador.
