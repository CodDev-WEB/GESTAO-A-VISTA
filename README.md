# Gestão à Vista

Aplicação web para gestão de desempenho comercial, com painel público para TV e área administrativa independente.

## Visão geral
- **Painel de visualização**: ranking diário, semanal e mensal, metas, faturamento, ticket médio, quantidade de vendas, pódio e mural rotativo de boas práticas.
- **Administração**: cadastro de colaboradoras, configuração de metas, importação diária CSV, fotos, estrelas e boas práticas.
- **Persistência**: Supabase (Postgres, Auth e Storage).
- **Interface**: React + TypeScript + Vite.

## Configuração
1. Instale Node.js 20+.
2. Execute `npm install`.
3. Copie `.env.example` para `.env.local` e informe `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
4. Execute o SQL de `supabase/schema.sql` no SQL Editor do Supabase.
5. Crie usuários no Supabase Auth. Cadastre os perfis na tabela `profiles` com papel `admin` ou `viewer`.
6. Execute `npm run dev`.

## Rotas
- `/`: painel público (rota de TV).
- `/admin/login`: login administrativo.
- `/admin`: administração, protegida por papel `admin`.
- `/viewer/login`: login independente da tela de visualização.
- `/viewer`: visualização autenticada para colaboradoras.

O painel público de TV não exibe controles administrativos. Para uma TV sem interação, use a rota `/` em tela cheia. O login de visualização permite uma experiência identificada e separada.

## Importação CSV
Colunas aceitas: `data`, `vendedora`, `valor`, `vendas`. Opcional: `ticket_medio`, `email`.
A identificação preferencial é pelo e-mail; sem e-mail, utiliza o nome normalizado. Reimportar o mesmo arquivo substitui os registros da mesma colaboradora na mesma data, evitando duplicidade. Revise os dados no preview antes de confirmar.

## Regras do painel
- Diário: vendas da data selecionada.
- Semanal: segunda-feira a domingo da semana selecionada.
- Mensal: primeiro ao último dia do mês selecionado.
- Ticket médio: faturamento dividido pela quantidade de vendas.
- Progresso da meta: faturamento do mês dividido pela meta mensal.
- Estrelas e boas práticas são atribuídas manualmente pelo administrador; não alteram o ranking financeiro.

## Segurança
As políticas RLS e as funções de autorização estão em `supabase/schema.sql`. Mantenha a chave `service_role` fora do frontend. Não use contas compartilhadas entre administração e visualização.
