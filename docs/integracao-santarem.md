# Integração Santarém Sistemas → Gestão à Vista

Objetivo: o Santarém Sistemas (Meu ERP Online) passa a ser a fonte automática das vendas, mantendo o Supabase atual e todas as funcionalidades existentes.

## Como funciona

```
API do ERP ──(Worker, consulta SQL fixa)──▶ erp_sales_daily (espelho do ERP, todos os valores)
                                         └▶ erp_unmatched_sales (funcionários sem vínculo)
erp_sales_daily + erp_seller_mappings ──(só com publicação ativa)──▶ sales_daily ──▶ rankings e TVs
```

| Arquivo | Papel |
|---|---|
| `src/worker/index.ts` | Serve o app (assets do Vite, fallback de SPA), rotas `/api/erp/*` e Cron Triggers |
| `src/worker/erp/client.ts` | HTTP com o ERP: autenticação, paginação offset/limit, limite de 18 req/min, repetição em 429 e falhas temporárias |
| `src/worker/erp/queries.ts` | Consulta SQL fixa (só SELECT) e validação das datas |
| `src/worker/erp/sync.ts` | Validação dos registros, espelho, pendências, publicação, trava contra execuções simultâneas, logs |
| `src/worker/supabase/client.ts` | Acesso ao Supabase com a chave service_role (só no Worker) |
| `src/ErpIntegration.tsx` | Admin → Integrações → Santarém Sistemas |
| `supabase/migrations/20261113150000_erp_integration.sql` | Tabelas, índices, chaves únicas e RLS |

### Consulta SQL

Baseada na consulta enviada pela loja, com os mesmos critérios comerciais:

- Vendas: `idempresa = 1`, `tipomovimento = 'S'`, `tipomovimentofinanceiro = 'R'`, `status = 'E'`, `idpessoafuncionario > 0` (valores por item de `documento_mercadoria`).
- Devoluções: `modelo = 'TM'`, `status = 'E'`, `tipomovimento = 'E'`, `tipomovimentofinanceiro = 'P'`.
- `valdescontoliquido = valdesconto − valdescontocashback`; `valor_medio_venda = (líquido − devolução) ÷ vendas`.

Mudanças, todas exigidas pela integração:

1. **Agrupamento por dia**, para aceitar um dia ou um intervalo.
2. **FULL OUTER JOIN corrigido:** a original não devolvia o `idpessoafuncionario` e unia só pelo funcionário. Quem só tinha devolução aparecia como `NENHUM`, sem código. Agora a união é por funcionário **e** dia, e o código e o nome vêm dos dois lados.
3. **Filtro de data por intervalo** `[início, fim + 1 dia)` em vez de `DATE(datahora) = dia`. O resultado é o mesmo e o filtro aproveita índice.
4. **Devolução subtraída uma única vez:** `valortotal = valtotalliquido − valordevolucao`. O Worker recusa qualquer registro em que essa conta não feche.

No teste local, a consulta nova devolveu exatamente os mesmos valores que a original para o mesmo dia.

### Mapeamento para `sales_daily`

| ERP (soma por colaboradora e dia) | `sales_daily` |
|---|---|
| `valortotal` (líquido de devoluções) | `revenue` |
| `valtotalliquido` (antes das devoluções) | `gross_revenue` |
| `valordevolucao` | `refund_amount` |
| `quantidade_vendas` | `sales_count` |
| — | `source = 'erp'`, `erp_synced_at` |

`valtotalbruto` (antes dos descontos), descontos, cashback e acréscimo ficam guardados em `erp_sales_daily`. **Decisão para validar:** o pedido diz "valtotalbruto → faturamento bruto". Porém o app usa `gross_revenue` para o ticket médio (Checkout), e hoje ele é o valor **depois** dos descontos, como na planilha. Usar `valtotalbruto` inflaria o ticket. Por isso `gross_revenue` recebe `valtotalliquido`. Se preferir o bruto, a troca é de uma linha em `publishRange`.

Se **dois códigos** do ERP forem vinculados à **mesma** colaboradora, os valores são somados no dia.

## Secrets (Cloudflare)

Nunca coloque essas chaves no código, no chat ou no banco. No terminal, na pasta do projeto:

```bash
npx wrangler secret put ERP_TOKEN                  # token do Santarém Sistemas
npx wrangler secret put SUPABASE_URL               # https://zlmmcczxinvdzrjshbcl.supabase.co
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY  # Supabase → Project Settings → API Keys → service_role / sb_secret_
```

Ou pelo painel: Cloudflare → Workers & Pages → `gestao-a-vista` → Settings → Variables and Secrets → Add → tipo **Secret**.

Variáveis comuns (já em `wrangler.jsonc`, ajuste se o fornecedor pedir outro formato):

| Variável | Padrão | Uso |
|---|---|---|
| `ERP_AUTH_SCHEME` | `Authentication` | Envia `Authorization: Authentication TOKEN`. Troque para `Bearer` se o fornecedor pedir |
| `ERP_SEND_X_TOKEN` | `false` | `true` para enviar também `X-ERP-Token: TOKEN` |
| `ERP_PAGINATION` | `query` | `offset`/`limit` na URL; `body` para enviar no JSON |
| `ERP_PAGE_SIZE` | `100` | Registros por página (o ERP devolve no máximo 100 por consulta) |

## Publicação e ativação segura

1. **Banco:** execute `supabase/migrations/20261113150000_erp_integration.sql` no SQL Editor do Supabase. É idempotente e não altera dados existentes.
2. **Secrets:** cadastre os três Secrets acima.
3. **Deploy:** faça o merge do PR. O Workers Builds publica o Worker com as rotas e os Cron Triggers. Os crons não fazem nada enquanto a sincronização automática estiver desligada (padrão).
4. **Admin → Integrações → Testar conexão:** confirma a autenticação e mostra o formato real da resposta e as colunas recebidas.
5. **Consultar vendas** de alguns dias fechados e **comparar com o relatório oficial** do Santarém Sistemas. Essa etapa não grava nada.
6. **Associar** cada código de funcionário à colaboradora (pendências ou associação manual).
7. **Sincronizar agora** um período (até 92 dias por vez) para preencher o espelho. Os rankings ainda não mudam.
8. Ligar a **sincronização automática**.
9. Por último, **Ativar publicação** a partir de uma data, digitando PUBLICAR. A partir dela, o ERP alimenta `sales_daily` e os rankings. Datas anteriores ficam com as importações manuais. Rode **Sincronizar agora** para preencher o período.

Para voltar atrás: **Desligar publicação**. Os rankings param de receber o ERP e nada é apagado.

## Rotas (todas exigem sessão de admin ativo)

| Rota | O que faz |
|---|---|
| `GET /api/erp/status` | Estado, contadores, última e próxima sincronização, erros recentes |
| `POST /api/erp/test` | Testa autenticação e formato da resposta (consulta de hoje, 1 registro) |
| `POST /api/erp/sync` | `{start, end, mode}`. `mode: "query"` só consulta; `"manual"` e `"initial"` gravam |
| `GET /api/erp/logs` | Histórico de execuções |
| `GET /api/erp/unmatched` | Pendências por funcionário |
| `GET/POST/DELETE /api/erp/mappings` | Lista, associa e desvincula códigos |
| `POST /api/erp/settings` | Liga/desliga sincronização e publicação, dias de reprocessamento |

O navegador só envia datas. A consulta SQL é montada no Worker, e as datas são validadas: formato, data real, fim ≥ início e até 92 dias.

## Rodapé "Últimas vendas" (TV de valores)

A cada sincronização que inclui o dia de hoje, o Worker faz uma consulta curta ao ERP com as **5 vendas mais recentes**: documento, horário, funcionário e valor líquido. Os critérios de venda são os mesmos do ranking, e a lista inclui quem não participa do ranking, como a gerência.

A lista fica em `erp_integrations.recent_sales`. A TV lê pela função `erp_recent_sales()`, que só devolve nomes, valores e horários, e só com a publicação ativa. Ela é atualizada a cada 5 minutos, junto com a sincronização.

Migração: `supabase/migrations/20261113200000_erp_recent_sales.sql`.

## Agendamento (fuso America/Belem)

- **A cada 5 minutos:** ontem e hoje.
- **06:30 (09:30 UTC):** reprocessa os últimos N dias (padrão 7) para capturar correções, cancelamentos e devoluções.
- Uma trava no banco impede duas execuções ao mesmo tempo (expira em 10 minutos se o Worker cair).
- Falha, leitura incompleta ou registro inválido: nada é publicado e os dados válidos existentes ficam como estão. Um registro que sumiu do ERP num período lido por completo é zerado, nunca apagado.

## Relatório de testes

Rodados localmente com:

- Postgres 16, com o schema e as migrations reais.
- Um banco que imita as tabelas do ERP, onde roda a consulta SQL real.
- O Worker executando contra um ERP simulado e um Supabase simulado (PostgREST).

**Resultado: 48 verificações, 48 aprovadas.**

| # | Teste obrigatório | Resultado |
|---|---|---|
| 1 | Autenticação com o ERP (`Authorization: Authentication TOKEN`) | OK |
| 2 | Consulta de um único dia (e "Consultar" não grava nada) | OK |
| 3 | Consulta de múltiplos funcionários | OK |
| 4 | Funcionário sem associação vai para pendências e não entra no ranking | OK |
| 5 | Funcionário com devolução sem venda aparece com código e nome (−R$ 30, 0 vendas) | OK |
| 6 | Descontos, cashback e acréscimo (bruto 180, desc. líq. 5, cashback 5, acréscimo 2, líquido 172, total 152) | OK |
| 7 | Reprocessamento sem duplicidade (3 execuções, mesmo resultado, 1 linha por colaboradora e dia) | OK |
| 8 | Paginação (offsets 0, 2, 4 com 2 por página) | OK |
| 9 | Falha de autenticação: erro claro e nada gravado | OK |
| 10 | ERP indisponível: erro registrado e dados preservados | OK |
| 11 | Permissões: sem sessão 401, TV 403, admin inativo 403, admin ativo 200 | OK |
| 12 | RLS: só admin ativo lê as tabelas; ninguém grava pelo navegador; anônimo sem acesso | OK |
| 13 | Typecheck do Worker e do app | OK localmente; build Vite completo roda no CI do PR |
| 14 | Painel TV: "Atualizado às" usa o horário da última sincronização publicada | OK |

Casos extras aprovados:

- Ativar a publicação exige data e a palavra PUBLICAR.
- A importação manual anterior à data de publicação fica preservada, e o setor das colaboradoras não muda.
- Uma venda cancelada no ERP é zerada no reprocessamento.
- Associar um funcionário resolve a pendência e publica os dias dele.
- São recusados sem gravar nada: registro inválido, devolução subtraída duas vezes e registro repetido entre páginas.
- Uma API que ignora o offset é marcada como parcial e não publica.
- Resposta no formato `{dados: [...]}` é reconhecida.
- HTTP 429: o Worker espera o Retry-After e repete.
- Execução simultânea é bloqueada.
- Datas com SQL injetado são recusadas, e toda consulta enviada ao ERP é o SELECT fixo.
- Cron: desligado não roda; ligado sincroniza ontem e hoje; o reprocessamento diário cobre os últimos 7 dias.
- Controle de taxa: limite por minuto e intervalo mínimo entre requisições.

**Não testado com a API real.** O ambiente de desenvolvimento não alcança `api.meuerponline.com.br`. Os passos 4 e 5 da ativação fazem essa validação.

## Funcionalidades preservadas

Cadastro de colaboradoras, fotos, setores Salão/Digital/Checkout, metas semanais, plano mensal de metas, ranking financeiro, ranking de boas ações (sem filtros comerciais), reconhecimentos, autenticação e permissões, as três telas da TV e a identidade visual, importação manual de planilha/CSV e filtros Diário, Semanal, Mensal e Período. Nenhuma tabela foi apagada ou recriada.

## Pendências

1. **Validar com a API real** (passo 4): formato do cabeçalho de autenticação, se `offset`/`limit` vão na URL ou no corpo, e o formato da resposta.
2. **Confirmar o banco do ERP:** a consulta usa `FULL OUTER JOIN`, como a original. Isso funciona em PostgreSQL, SQL Server e Oracle, mas não em MySQL. Como a consulta original já usa esse recurso, o ERP provavelmente aceita.
3. **Comparar com o relatório oficial** do ERP antes de ativar a publicação (passo 5).
4. **Decidir `gross_revenue`:** `valtotalliquido` (atual, preserva o ticket médio) ou `valtotalbruto`.
5. **Devoluções:** seguem a consulta original, que atribui a devolução ao funcionário do item devolvido, no dia da devolução.
6. **Logs:** a cada 5 minutos fica um registro no histórico (~288 por dia). Se pesar, dá para registrar só execuções com mudança ou erro.
