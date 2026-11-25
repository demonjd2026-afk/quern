// SQL code generator (DuckDB dialect). Every source and pipeline becomes a
// view; every pipeline step becomes one named CTE, so the output reads in the
// same order as the Quern program and each step can be inspected on its own.

import type { ColType, Relation, TExpr, TPipeline, TProgram, TSource, TStep } from './ir.ts';

const SQL_TYPE: Readonly<Record<ColType['base'], string>> = {
  int: 'BIGINT',
  float: 'DOUBLE',
  text: 'VARCHAR',
  bool: 'BOOLEAN',
  date: 'DATE',
};

export const ident = (name: string): string => `"${name.replaceAll('"', '""')}"`;
export const text = (value: string): string => `'${value.replaceAll("'", "''")}'`;

export interface SqlOptions {
  /** Maps a path written in the program to the path the engine should open. */
  resolvePath?: (path: string) => string;
}

/** One SQL statement per declaration, in program order. */
export function generateStatements(program: TProgram, options: SqlOptions = {}): string[] {
  const resolve = options.resolvePath ?? ((p: string) => p);
  return program.items.map((item) => {
    if (item.kind === 'source') return sourceSql(item, resolve(item.path));
    if (item.kind === 'pipeline') return pipelineSql(item);
    return `COPY (SELECT * FROM ${ident(item.pipeline)}) TO ${text(resolve(item.path))} (FORMAT ${formatOf(item.path)});`;
  });
}

export function generateSql(program: TProgram, options: SqlOptions = {}): string {
  return generateStatements(program, options).join('\n\n') + '\n';
}

function formatOf(path: string): string {
  if (path.endsWith('.parquet')) return 'PARQUET';
  if (path.endsWith('.json')) return 'JSON';
  return 'CSV, HEADER';
}

// Columns are matched by header name, not position, and extra columns in the
// file are ignored. An empty field is null. Both rules match the interpreter.
function sourceSql(source: TSource, path: string): string {
  const columns = source.relation.columns
    .map((c) => `  CAST(NULLIF(${ident(c.name)}, '') AS ${SQL_TYPE[c.type.base]}) AS ${ident(c.name)}`)
    .join(',\n');
  return `CREATE OR REPLACE VIEW ${ident(source.name)} AS\nSELECT\n${columns}\nFROM read_csv(${text(path)}, header = true, all_varchar = true);`;
}

function pipelineSql(pipeline: TPipeline): string {
  // SQL only guarantees row order for the outermost SELECT, so a trailing
  // order step is emitted there. With a limit it also needs its own CTE.
  const final = pipeline.steps[pipeline.steps.length - 1]!;
  const trailingOrder = final.kind === 'order' ? final : null;
  const inline = trailingOrder !== null && trailingOrder.limit === null;
  const steps = inline ? pipeline.steps.slice(0, -1) : pipeline.steps;
  const ctes = steps.map((step, i) => `  s${i} AS (${stepSql(step, `s${i - 1}`)})`);
  const order = trailingOrder ? ` ${orderBy(trailingOrder)}` : '';
  return `CREATE OR REPLACE VIEW ${ident(pipeline.name)} AS\nWITH\n${ctes.join(',\n')}\nSELECT * FROM s${steps.length - 1}${order};`;
}

function orderBy(step: Extract<TStep, { kind: 'order' }>): string {
  const keys = step.keys.map((k) => `${ident(k.column)} ${k.descending ? 'DESC' : 'ASC'} NULLS LAST`).join(', ');
  return `ORDER BY ${keys}`;
}

function stepSql(step: TStep, prev: string): string {
  switch (step.kind) {
    case 'from':
      return `SELECT * FROM ${ident(step.relation)}`;
    case 'join': {
      const right = step.rightColumns.map((c) => `, r.${ident(c)}`).join('');
      const on = step.on.map((p) => `l.${ident(p.left)} = r.${ident(p.right)}`).join(' AND ');
      return `SELECT l.*${right} FROM ${prev} AS l ${step.outer ? 'LEFT JOIN' : 'JOIN'} ${ident(step.relation)} AS r ON ${on}`;
    }
    case 'where':
      return `SELECT * FROM ${prev} WHERE ${exprSql(step.predicate)}`;
    case 'let':
      return `SELECT *, ${typed(step.value)} AS ${ident(step.name)} FROM ${prev}`;
    case 'select':
      return `SELECT ${step.items.map((it) => `${typed(it.value)} AS ${ident(it.name)}`).join(', ')} FROM ${prev}`;
    case 'group': {
      const keys = step.keys.map(ident);
      const aggs = step.aggregates.map((a) => {
        const arg = a.arg ? exprSql(a.arg) : '';
        const call = a.fn === 'count' ? 'COUNT(*)' : a.fn === 'count_distinct' ? `COUNT(DISTINCT ${arg})` : `${a.fn.toUpperCase()}(${arg})`;
        return `CAST(${call} AS ${SQL_TYPE[a.type.base]}) AS ${ident(a.name)}`;
      });
      const groupBy = keys.length > 0 ? ` GROUP BY ${keys.join(', ')}` : '';
      return `SELECT ${[...keys, ...aggs].join(', ')} FROM ${prev}${groupBy}`;
    }
    case 'order':
      return `SELECT * FROM ${prev} ${orderBy(step)}${step.limit !== null ? ` LIMIT ${step.limit}` : ''}`;
  }
}

/** An expression cast to the type the checker inferred, so view schemas match Quern types exactly. */
function typed(e: TExpr): string {
  return e.kind === 'column' ? ident(e.name) : `CAST(${exprSql(e)} AS ${SQL_TYPE[e.type.base]})`;
}

export function exprSql(e: TExpr): string {
  switch (e.kind) {
    case 'column':
      return ident(e.name);
    case 'literal':
      if (e.value === null) return 'NULL';
      if (e.type.base === 'text') return text(String(e.value));
      if (e.type.base === 'date') return `DATE ${text(String(e.value))}`;
      if (e.type.base === 'bool') return e.value ? 'TRUE' : 'FALSE';
      if (e.type.base === 'float') return `CAST(${String(e.value)} AS DOUBLE)`;
      return `CAST(${String(e.value)} AS BIGINT)`;
    case 'arith':
      // DuckDB's `/` is floating-point division for every numeric type.
      if (e.op === '/') return `(${exprSql(e.left)} / NULLIF(${exprSql(e.right)}, 0))`;
      return `(${exprSql(e.left)} ${e.op} ${exprSql(e.right)})`;
    case 'compare':
      return `(${exprSql(e.left)} ${e.op === '!=' ? '<>' : e.op} ${exprSql(e.right)})`;
    case 'logic':
      return `(${exprSql(e.left)} ${e.op.toUpperCase()} ${exprSql(e.right)})`;
    case 'not':
      return `(NOT ${exprSql(e.operand)})`;
    case 'negate':
      return `(-${exprSql(e.operand)})`;
    case 'isnull':
      return `(${exprSql(e.operand)} IS ${e.negated ? 'NOT ' : ''}NULL)`;
    case 'coalesce':
      return `COALESCE(${exprSql(e.left)}, ${exprSql(e.right)})`;
    case 'call': {
      const a = e.args.map(exprSql);
      switch (e.fn) {
        case 'hash':
          return `md5(CAST(${a[0]} AS VARCHAR))`;
        case 'lower':
          return `lower(${a[0]})`;
        case 'upper':
          return `upper(${a[0]})`;
        case 'abs':
          return `abs(${a[0]})`;
        case 'round':
          return `round(CAST(${a[0]} AS DOUBLE), ${String((e.args[1] as { value: number }).value)})`;
        case 'convert':
          return `(${a[0]} * ${a[1]})`;
      }
    }
  }
}

/**
 * The compiler trusts what a source declares (non-null columns, keys). This
 * emits one query that tests those declarations against the real data and
 * returns a row per violated declaration, so the trust can be checked.
 */
export function generateVerifySql(program: TProgram): string {
  const checks: string[] = [];
  for (const item of program.items) {
    if (item.kind !== 'source') continue;
    checks.push(...relationChecks(item.name, item.relation));
  }
  if (checks.length === 0) return `SELECT NULL AS source, NULL AS declaration, 0 AS violations WHERE FALSE;\n`;
  return `SELECT * FROM (\n${checks.join('\nUNION ALL\n')}\n) WHERE violations > 0;\n`;
}

function relationChecks(name: string, rel: Relation): string[] {
  const out: string[] = [];
  for (const c of rel.columns) {
    if (c.type.nullable) continue;
    out.push(`  SELECT ${text(name)} AS source, ${text(`${c.name} is not null`)} AS declaration, COUNT(*) AS violations FROM ${ident(name)} WHERE ${ident(c.name)} IS NULL`);
  }
  for (const key of rel.keys) {
    const cols = key.map(ident).join(', ');
    out.push(
      `  SELECT ${text(name)} AS source, ${text(`key (${key.join(', ')})`)} AS declaration, COUNT(*) AS violations FROM (SELECT 1 FROM ${ident(name)} GROUP BY ${cols} HAVING COUNT(*) > 1)`,
    );
  }
  return out;
}
