// The typed intermediate representation. The checker lowers the AST into this
// form; the SQL generator and the reference interpreter both consume it, so
// neither has to repeat name resolution or type inference.

export type Base = 'int' | 'float' | 'text' | 'bool' | 'date';

/** The type of one column: its base type plus the facts Quern tracks about it. */
export interface ColType {
  base: Base;
  nullable: boolean;
  /** Unit of measure such as USD or ms; null means dimensionless. */
  unit: string | null;
  /** True when the value is derived from personally identifiable data. */
  pii: boolean;
}

export interface Column {
  name: string;
  type: ColType;
  /**
   * True when a join has repeated this column's source rows, so adding its
   * values up (sum, avg) would count them more than once.
   */
  duplicated: boolean;
  /** Relations this column can be qualified with, e.g. `customers.region`. */
  origins: string[];
}

/** A relation type: columns plus every column set known to be unique per row. */
export interface Relation {
  columns: Column[];
  /** Candidate keys. An empty key means the relation has at most one row. */
  keys: string[][];
  /**
   * Functional dependencies learned from to-one joins: within this relation,
   * rows that agree on `from` also agree on every column in `to`.
   */
  dependencies: Dependency[];
}

export interface Dependency {
  from: string[];
  to: string[];
}

// ---- typed expressions ----

export type Value = number | string | boolean | null;

export type TExpr =
  | { kind: 'column'; name: string; type: ColType }
  | { kind: 'literal'; value: Value; type: ColType }
  | { kind: 'arith'; op: '+' | '-' | '*' | '/'; left: TExpr; right: TExpr; type: ColType }
  | { kind: 'compare'; op: '=' | '!=' | '<' | '<=' | '>' | '>='; left: TExpr; right: TExpr; type: ColType }
  | { kind: 'logic'; op: 'and' | 'or'; left: TExpr; right: TExpr; type: ColType }
  | { kind: 'not'; operand: TExpr; type: ColType }
  | { kind: 'negate'; operand: TExpr; type: ColType }
  | { kind: 'isnull'; operand: TExpr; negated: boolean; type: ColType }
  | { kind: 'coalesce'; left: TExpr; right: TExpr; type: ColType }
  | { kind: 'call'; fn: ScalarFn; args: TExpr[]; type: ColType };

export type ScalarFn = 'hash' | 'lower' | 'upper' | 'abs' | 'round' | 'convert';
export type AggregateFn = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'count_distinct';

// ---- typed steps ----

export type TStep =
  | { kind: 'from'; relation: string; out: Relation }
  | {
      kind: 'join';
      outer: boolean;
      relation: string;
      on: { left: string; right: string }[];
      /** Right-hand columns carried into the result (merged key columns are dropped). */
      rightColumns: string[];
      out: Relation;
    }
  | { kind: 'where'; predicate: TExpr; out: Relation }
  | { kind: 'let'; name: string; value: TExpr; out: Relation }
  | { kind: 'select'; items: { name: string; value: TExpr }[]; out: Relation }
  | {
      kind: 'group';
      keys: string[];
      aggregates: { name: string; fn: AggregateFn; arg: TExpr | null; type: ColType }[];
      out: Relation;
    }
  | { kind: 'order'; keys: { column: string; descending: boolean }[]; limit: number | null; out: Relation };

export interface TSource {
  kind: 'source';
  name: string;
  path: string;
  relation: Relation;
}

export interface TPipeline {
  kind: 'pipeline';
  name: string;
  steps: TStep[];
  relation: Relation;
}

export interface TPublish {
  kind: 'publish';
  pipeline: string;
  visibility: 'public' | 'restricted';
  path: string;
}

export type TItem = TSource | TPipeline | TPublish;

export interface TProgram {
  /** Declarations in source order; every reference points backwards. */
  items: TItem[];
}

export function showType(t: ColType): string {
  return `${t.base}${t.unit ? `<${t.unit}>` : ''}${t.nullable ? '?' : ''}${t.pii ? ' pii' : ''}`;
}
