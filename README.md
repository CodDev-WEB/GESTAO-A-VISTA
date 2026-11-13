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


## Metas semanais por setor

A equipe pode ser vinculada a um dos setores: **Salão**, **Digital** ou **Checkout**. O vínculo é configurável no cadastro e também pode ser alterado na lista de colaboradoras.

- **Salão:** meta semanal coletiva em quantidade de vendas.
- **Digital:** meta semanal coletiva em quantidade de conversões.
- **Checkout:** meta semanal coletiva em faturamento (R$).
- O painel percentual tem os mesmos filtros da TV: **Diário**, **Semanal**, **Mensal** e **Período**.
- O percentual de cada colaborador é calculado sobre sua cota individual: meta semanal do setor dividida pelo número de colaboradores ativos e habilitados para vendas naquele setor.
- O progresso coletivo do setor é calculado sobre a meta integral do setor.
- O progresso não é limitado a 100%: resultados de 120%, 130% ou mais são exibidos integralmente. A barra visual permanece preenchida em 100% para não ultrapassar o cartão, enquanto o percentual numérico mostra a superação.
- A meta de cada setor é proporcional aos dias do filtro: cada dia vale 1/7 da meta semanal. No diário vale 1/7 da semana; no semanal, a semana inteira; no mensal e no período, a soma dos dias de cada semana que caem dentro das datas. Os resultados são apurados nas mesmas datas.
- A tela de valores continua usando os indicadores monetários e os filtros próprios. O ranking de boas ações permanece histórico e independente dos filtros de vendas.

### Migração do Supabase

Execute no SQL Editor o arquivo `supabase/migrations/20261112000000_sector_goals.sql` para adicionar o campo `sellers.sector`, a tabela `sector_goals` e suas políticas RLS. A migração preserva os dados existentes. Depois, atribua um setor a cada colaborador participante de vendas e cadastre as metas semanais no menu **Administração → Metas**.

## Plano de meta comercial (a partir de novembro/2026)

As metas seguem o **Plano de Meta Comercial** do mês, cadastrado em **Administração → Metas**:

- **Semanas com datas próprias**, como no plano impresso (ex.: 01 a 08, 09 a 15, 16 a 22 e 23 a 30).
- Para cada semana: **meta da loja** e divisão em **venda salão** e **venda digital** (R$); **metas dos setores**: Salão em quantidade de vendas, Digital em conversões e Checkout em **ticket médio** (indicador); e as faixas **Meta**, **Super** e **Diamante** em R$: por pessoa no Salão e no Digital, e **da equipe** no Checkout.
- No mês: meta mensal da loja, **bonificação** por nível (Meta, Super, Diamante) e **aumento percentual por setor** (registrado como referência).

Filtros (TV com valores e tela de %):

- **Semanal:** usa a semana do plano que contém a data (ex.: 01 a 08), escolhida em um seletor "1ª semana (01/11 a 08/11)". Sem plano para a data, vale segunda a domingo.
- **Diário:** meta do dia = meta da semana do plano ÷ número de dias da semana (a 1ª e a 4ª semana de novembro têm 8 dias).
- **Mensal:** meta mensal da loja; as metas de setor e individuais somam todas as semanas do mês.
- **Período:** soma proporcional dos dias de cada semana do plano dentro das datas.
- O bloco da meta mostra a meta do filtro escolhido (do dia, da semana ou do mês).

Na tela de %:

- A meta de cada filtro (Diário, Semanal, Mensal ou Período) é a soma das semanas do plano, proporcional aos dias de cada semana que caem no período. O ticket médio do Checkout é a média das semanas, ponderada pelos dias.
- O ranking mostra o **% da meta individual** (faturamento da pessoa ÷ meta individual do setor), o **% da cota do setor** (Salão e Digital: vendas da pessoa ÷ meta do setor dividida pelo número de pessoas) e o **nível** alcançado. Os valores das bonificações aparecem só no admin.
- **Checkout é uma equipe com resultado único.** O faturamento somado das vendedoras do Checkout é comparado com Meta, Super e Diamante da equipe. Se a equipe bate um nível, todas recebem esse nível, e o valor da bonificação é dividido pelo número de vendedoras do Checkout. O % de cada pessoa é o faturamento dela ÷ (meta da equipe ÷ número de vendedoras). O ticket médio continua aparecendo como indicador.
- **Situação da meta nos painéis:** o setor que atinge 100% mostra **Meta batida** na hora (com o nível, no Checkout). Os setores que não chegaram a 100% mostram **Faltam X%** enquanto o período está aberto e **Não bateu** quando o período (semana, mês ou dia) termina. Na TV de valores, a faixa de faturamento por setor compara com as metas em R$ do plano (venda salão, venda digital e meta da equipe do Checkout).
- Sem plano cadastrado para o período, a tela usa as metas semanais por setor do modelo anterior.

### Migração do plano

Execute no SQL Editor do Supabase o arquivo `supabase/migrations/20261112020000_goal_plan.sql`. Ele cria a tabela `goal_weeks`, adiciona bonificação e aumento por setor à tabela `goals` e já cadastra o plano de novembro de 2026. É seguro executar mais de uma vez.

## Ranking por setor (terceira tela)

Rotas: `/viewer/sectors` (TV) e `/admin/sectors` (admin). Mesma base da tela de %: filtros Diário, Semanal, Mensal e Período, meta do período e os três setores no topo, e a coluna de boas ações e reconhecimentos.

- Um ranking para cada setor: **Salão** (coluna larga), **Digital** e **Checkout** (empilhados).
- Em cada ranking: posição, nome, nível (Meta, Super, Diamante), % da meta individual e vendas; no Checkout, também o ticket médio de cada pessoa. A líder de cada setor fica destacada.
- O seletor **R$ · % · Setores** no cabeçalho alterna entre as três telas.
- Na TV, os nomes aparecem só com iniciais maiúsculas ("EDILAINE  CARDOSO" → "Edilaine Cardoso"); o cadastro não muda.
