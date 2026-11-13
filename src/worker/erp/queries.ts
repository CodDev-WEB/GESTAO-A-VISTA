// Consulta SQL fixa enviada ao Santarém Sistemas. O navegador nunca envia SQL:
// o Worker só aceita datas, valida e monta a consulta aqui.
//
// Base: consulta fornecida pela loja (relatório de vendas por funcionário).
// Critérios comerciais preservados; mudanças apenas onde o pedido de integração exige:
//   1. Agrupa também por dia (DATE(d.datahora)), para aceitar um dia ou um intervalo.
//   2. Devolve idpessoafuncionario e dia de qualquer um dos lados do FULL OUTER JOIN
//      (antes, quem só tinha devolução saía sem código e com nome 'NENHUM').
//   3. O nome vem da tabela pessoa depois da junção, para os dois casos.
//   4. Filtro de data por intervalo [início, fim + 1 dia) em vez de DATE(...) = dia
//      (mesmo resultado, aproveita índice de datahora).
//   5. Devolução continua subtraída UMA vez só: valortotal = valtotalliquido - valordevolucao.

const MAX_RANGE_DAYS = 92

export type DateRange = { start: string; end: string }

/** Valida AAAA-MM-DD como data real (rejeita 2026-02-30, textos, SQL etc.). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 2020 && y <= 2100
}

export function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export function daysBetween(start: string, end: string) {
  return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000)
}

export function validateRange(start: unknown, end: unknown): DateRange {
  if (!isIsoDate(start) || !isIsoDate(end)) throw new RangeError('Datas inválidas. Use AAAA-MM-DD.')
  if (end < start) throw new RangeError('A data final é anterior à inicial.')
  if (daysBetween(start, end) + 1 > MAX_RANGE_DAYS) throw new RangeError(`Período máximo de ${MAX_RANGE_DAYS} dias por sincronização.`)
  return { start, end }
}

/** Divide um período longo em blocos (para sincronização inicial). */
export function splitRange(range: DateRange, chunkDays = 31): DateRange[] {
  const out: DateRange[] = []
  for (let s = range.start; s <= range.end; s = addDays(s, chunkDays)) {
    const e = addDays(s, chunkDays - 1)
    out.push({ start: s, end: e < range.end ? e : range.end })
  }
  return out
}

/**
 * Vendas e devoluções por funcionário e por dia (valores por item de documento_mercadoria).
 *
 * Vendas:     d.idempresa = empresa, d.tipomovimento = 'S', d.tipomovimentofinanceiro = 'R',
 *             d.status = 'E', dm.idpessoafuncionario > 0.
 * Devoluções: d.idempresa = empresa, d.modelo = 'TM', d.status = 'E', d.tipomovimento = 'E',
 *             d.tipomovimentofinanceiro = 'P'.
 * valdescontoliquido = valdesconto - valdescontocashback (como na consulta original).
 * valor_medio_venda  = (valtotalliquido - valordevolucao) / quantidade_vendas (como na original).
 *
 * Só SELECT. Datas já validadas por validateRange; nenhum outro valor vem de fora.
 */
export function buildSalesQuery(range: DateRange, companyId: number): string {
  const { start, end } = validateRange(range.start, range.end)
  if (!Number.isInteger(companyId) || companyId <= 0) throw new RangeError('Empresa inválida.')
  const endExclusive = addDays(end, 1)
  const sql = `
WITH Vendas AS (
  SELECT dm.idpessoafuncionario AS idfunc,
         DATE(d.datahora) AS dia,
         SUM(dm.valtotalliquido) AS valtotalliquido,
         SUM(dm.valtotalbruto) AS valtotalbruto,
         SUM(dm.valdesconto) AS valdescontobruto,
         SUM(dm.valdescontocashback) AS valdescontocashback,
         SUM(dm.valacrescimo) AS valacrescimo,
         COUNT(DISTINCT d._iddocumento) AS quantidade_vendas
    FROM documento d
    JOIN documento_mercadoria dm ON (dm._iddocumento = d._iddocumento)
   WHERE d.idempresa = ${companyId}
     AND d.tipomovimento = 'S'
     AND dm.idpessoafuncionario > 0
     AND d.datahora >= '${start}'
     AND d.datahora < '${endExclusive}'
     AND d.tipomovimentofinanceiro = 'R'
     AND d.status = 'E'
   GROUP BY dm.idpessoafuncionario, DATE(d.datahora)
),
Devolucoes AS (
  SELECT dm.idpessoafuncionario AS idfunc,
         DATE(d.datahora) AS dia,
         SUM(dm.valtotalliquido) AS valordevolucao
    FROM documento d
    JOIN documento_mercadoria dm ON (dm._iddocumento = d._iddocumento)
   WHERE d.idempresa = ${companyId}
     AND d.datahora >= '${start}'
     AND d.datahora < '${endExclusive}'
     AND d.modelo IN ('TM')
     AND d.status = 'E'
     AND d.tipomovimento = 'E'
     AND d.tipomovimentofinanceiro = 'P'
   GROUP BY dm.idpessoafuncionario, DATE(d.datahora)
)
SELECT COALESCE(v.idfunc, dv.idfunc) AS idpessoafuncionario,
       COALESCE(v.dia, dv.dia) AS dia,
       COALESCE(p.nome, 'NENHUM') AS nome,
       COALESCE(v.valtotalbruto, 0) AS valtotalbruto,
       COALESCE(v.valdescontobruto, 0) - COALESCE(v.valdescontocashback, 0) AS valdescontoliquido,
       COALESCE(v.valdescontocashback, 0) AS valdescontocashback,
       COALESCE(v.valacrescimo, 0) AS valacrescimo,
       COALESCE(v.valtotalliquido, 0) AS valtotalliquido,
       COALESCE(dv.valordevolucao, 0) AS valordevolucao,
       COALESCE(v.valtotalliquido, 0) - COALESCE(dv.valordevolucao, 0) AS valortotal,
       COALESCE(v.quantidade_vendas, 0) AS quantidade_vendas,
       COALESCE(v.valdescontobruto, 0) AS valdescontobruto,
       CASE WHEN v.quantidade_vendas > 0
            THEN (COALESCE(v.valtotalliquido, 0) - COALESCE(dv.valordevolucao, 0)) / v.quantidade_vendas
            ELSE 0 END AS valor_medio_venda
  FROM Vendas v
  FULL OUTER JOIN Devolucoes dv ON (dv.idfunc = v.idfunc AND dv.dia = v.dia)
  LEFT JOIN pessoa p ON (p._idpessoa = COALESCE(v.idfunc, dv.idfunc))
 ORDER BY 2, 3, 1`.trim()
  assertReadOnly(sql)
  return sql
}

/** Defesa extra: a consulta montada tem de ser um único SELECT/WITH, sem comandos de escrita. */
export function assertReadOnly(sql: string) {
  const s = sql.replace(/'[^']*'/g, "''")
  if (!/^\s*(WITH|SELECT)\b/i.test(s)) throw new Error('Consulta precisa começar com SELECT ou WITH.')
  if (s.includes(';')) throw new Error('Consulta não pode conter ";".')
  if (/\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|EXEC|EXECUTE|CALL|COPY|INTO)\b/i.test(s)) throw new Error('Consulta contém comando não permitido.')
}
