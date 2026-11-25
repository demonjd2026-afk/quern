import type { Span } from './diagnostics.ts';

export interface Ident {
  name: string;
  span: Span;
}

export interface StringLit {
  value: string;
  span: Span;
}

export type BaseName = 'int' | 'float' | 'text' | 'bool' | 'date';

export interface ColumnDecl {
  name: Ident;
  base: BaseName;
  unit: Ident | null;
  nullable: boolean;
  key: boolean;
  pii: boolean;
  span: Span;
}

export interface SourceDecl {
  kind: 'source';
  name: Ident;
  path: StringLit;
  columns: ColumnDecl[];
  /** Composite keys declared with `key (a, b)`. */
  compositeKeys: Ident[][];
  span: Span;
}

export interface PipelineDecl {
  kind: 'pipeline';
  name: Ident;
  steps: Step[];
  span: Span;
}

export interface PublishDecl {
  kind: 'publish';
  pipeline: Ident;
  visibility: 'public' | 'restricted';
  path: StringLit;
  span: Span;
}

export type Decl = SourceDecl | PipelineDecl | PublishDecl;

export interface Program {
  decls: Decl[];
}

// ---- pipeline steps ----

export interface FromStep {
  kind: 'from';
  relation: Ident;
  span: Span;
}

export interface JoinCondition {
  left: RefExpr;
  right: RefExpr;
  span: Span;
}

export interface JoinStep {
  kind: 'join';
  outer: boolean; // `left join`
  many: boolean; // `join many`
  manySpan: Span | null;
  relation: Ident;
  on: JoinCondition[];
  span: Span;
}

export interface WhereStep {
  kind: 'where';
  predicate: Expr;
  span: Span;
}

export interface LetStep {
  kind: 'let';
  name: Ident;
  value: Expr;
  span: Span;
}

export interface SelectItem {
  /** Present for `name = expr`; absent for a bare column reference. */
  name: Ident | null;
  value: Expr;
  span: Span;
}

export interface SelectStep {
  kind: 'select';
  items: SelectItem[];
  span: Span;
}

export interface GroupStep {
  kind: 'group';
  keys: RefExpr[];
  aggregates: { name: Ident; value: Expr; span: Span }[];
  span: Span;
}

export interface OrderStep {
  kind: 'order';
  keys: { column: RefExpr; descending: boolean }[];
  span: Span;
}

export interface LimitStep {
  kind: 'limit';
  count: number;
  span: Span;
}

export type Step = FromStep | JoinStep | WhereStep | LetStep | SelectStep | GroupStep | OrderStep | LimitStep;

// ---- expressions ----

export interface NumberExpr {
  kind: 'number';
  value: number;
  isFloat: boolean;
  unit: Ident | null;
  span: Span;
}

export interface StringExpr {
  kind: 'string';
  value: string;
  span: Span;
}

export interface BoolExpr {
  kind: 'bool';
  value: boolean;
  span: Span;
}

export interface DateExpr {
  kind: 'date';
  value: string;
  span: Span;
}

export interface RefExpr {
  kind: 'ref';
  qualifier: Ident | null;
  name: Ident;
  span: Span;
}

export type BinaryOp = '+' | '-' | '*' | '/' | '=' | '!=' | '<' | '<=' | '>' | '>=' | 'and' | 'or' | '??';

export interface BinaryExpr {
  kind: 'binary';
  op: BinaryOp;
  left: Expr;
  right: Expr;
  span: Span;
}

export interface UnaryExpr {
  kind: 'unary';
  op: '-' | 'not';
  operand: Expr;
  span: Span;
}

export interface IsNullExpr {
  kind: 'isnull';
  operand: Expr;
  negated: boolean;
  span: Span;
}

export interface CallExpr {
  kind: 'call';
  callee: Ident;
  args: Expr[];
  span: Span;
}

export type Expr = NumberExpr | StringExpr | BoolExpr | DateExpr | RefExpr | BinaryExpr | UnaryExpr | IsNullExpr | CallExpr;
