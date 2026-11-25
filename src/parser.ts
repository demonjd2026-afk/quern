// Hand-written recursive-descent parser. One syntax error is reported per
// declaration; the parser then resynchronises at the next top-level keyword so
// a single typo does not hide problems in the rest of the file.

import type * as A from './ast.ts';
import type { Diagnostics, Span } from './diagnostics.ts';
import type { Token } from './lexer.ts';

class SyntaxError_ extends Error {}

const BASE_TYPES: ReadonlySet<string> = new Set(['int', 'float', 'text', 'bool', 'date']);
const TOP_LEVEL: ReadonlySet<string> = new Set(['source', 'pipeline', 'publish']);
const STEP_STARTS: ReadonlySet<string> = new Set(['from', 'join', 'left', 'where', 'let', 'select', 'group', 'order', 'limit']);

export function parse(tokens: Token[], diags: Diagnostics): A.Program {
  return new Parser(tokens, diags).program();
}

class Parser {
  private pos = 0;
  private readonly tokens: Token[];
  private readonly diags: Diagnostics;

  constructor(tokens: Token[], diags: Diagnostics) {
    this.tokens = tokens;
    this.diags = diags;
  }

  program(): A.Program {
    const decls: A.Decl[] = [];
    while (!this.at('eof')) {
      try {
        decls.push(this.decl());
      } catch (e) {
        if (!(e instanceof SyntaxError_)) throw e;
        this.synchronise();
      }
    }
    return { decls };
  }

  // ---- token helpers ----

  private get tok(): Token {
    return this.tokens[this.pos]!;
  }

  private at(kind: Token['kind'], text?: string): boolean {
    const t = this.tok;
    return t.kind === kind && (text === undefined || t.text === text);
  }

  private atKw(text: string): boolean {
    return this.at('keyword', text);
  }

  private atSym(text: string): boolean {
    return this.at('symbol', text);
  }

  private next(): Token {
    const t = this.tok;
    if (t.kind !== 'eof') this.pos++;
    return t;
  }

  private eatKw(text: string): Token | null {
    return this.atKw(text) ? this.next() : null;
  }

  private eatSym(text: string): Token | null {
    return this.atSym(text) ? this.next() : null;
  }

  private fail(expected: string): never {
    const t = this.tok;
    const found = t.kind === 'eof' ? 'end of file' : `'${t.text}'`;
    this.diags.error('E0003', { start: t.start, end: Math.max(t.end, t.start + 1) }, `expected ${expected}, found ${found}`);
    throw new SyntaxError_();
  }

  private expectKw(text: string): Token {
    return this.eatKw(text) ?? this.fail(`'${text}'`);
  }

  private expectSym(text: string): Token {
    return this.eatSym(text) ?? this.fail(`'${text}'`);
  }

  private ident(what: string): A.Ident {
    if (!this.at('ident')) {
      if (this.tok.kind === 'keyword') this.fail(`${what} (note: '${this.tok.text}' is a reserved word)`);
      this.fail(what);
    }
    const t = this.next();
    return { name: t.text, span: { start: t.start, end: t.end } };
  }

  private string(what: string): A.StringLit {
    if (!this.at('string')) this.fail(what);
    const t = this.next();
    return { value: t.text, span: { start: t.start, end: t.end } };
  }

  private prevEnd(): number {
    return this.tokens[this.pos - 1]?.end ?? 0;
  }

  private synchronise(): void {
    while (!this.at('eof') && !(this.tok.kind === 'keyword' && TOP_LEVEL.has(this.tok.text))) this.pos++;
  }

  // ---- declarations ----

  private decl(): A.Decl {
    if (this.atKw('source')) return this.sourceDecl();
    if (this.atKw('pipeline')) return this.pipelineDecl();
    if (this.atKw('publish')) return this.publishDecl();
    const t = this.tok;
    this.diags.error('E0003', { start: t.start, end: t.end }, `expected 'source', 'pipeline' or 'publish', found '${t.text}'`);
    this.pos++;
    throw new SyntaxError_();
  }

  private sourceDecl(): A.SourceDecl {
    const start = this.expectKw('source').start;
    const name = this.ident('a source name');
    this.expectKw('from');
    const path = this.string('a file path in double quotes');
    this.expectSym('{');
    const columns: A.ColumnDecl[] = [];
    const compositeKeys: A.Ident[][] = [];
    while (!this.atSym('}')) {
      if (this.atKw('key')) {
        this.next();
        this.expectSym('(');
        const cols: A.Ident[] = [this.ident('a column name')];
        while (this.eatSym(',')) cols.push(this.ident('a column name'));
        this.expectSym(')');
        compositeKeys.push(cols);
      } else {
        columns.push(this.columnDecl());
      }
      if (!this.eatSym(',')) break;
    }
    this.expectSym('}');
    return { kind: 'source', name, path, columns, compositeKeys, span: { start, end: this.prevEnd() } };
  }

  private columnDecl(): A.ColumnDecl {
    const name = this.ident('a column name');
    this.expectSym(':');
    const typeTok = this.tok;
    if (!this.at('ident') || !BASE_TYPES.has(typeTok.text)) this.fail('a type (int, float, text, bool or date)');
    this.next();
    let unit: A.Ident | null = null;
    if (this.eatSym('<')) {
      unit = this.ident('a unit name such as USD');
      this.expectSym('>');
    }
    const nullable = this.eatSym('?') !== null;
    let key = false;
    let pii = false;
    for (;;) {
      if (this.eatKw('key')) key = true;
      else if (this.eatKw('pii')) pii = true;
      else break;
    }
    return { name, base: typeTok.text as A.BaseName, unit, nullable, key, pii, span: { start: name.span.start, end: this.prevEnd() } };
  }

  private pipelineDecl(): A.PipelineDecl {
    const start = this.expectKw('pipeline').start;
    const name = this.ident('a pipeline name');
    this.expectSym('{');
    const steps: A.Step[] = [];
    while (!this.atSym('}')) steps.push(this.step());
    this.expectSym('}');
    return { kind: 'pipeline', name, steps, span: { start, end: this.prevEnd() } };
  }

  private publishDecl(): A.PublishDecl {
    const start = this.expectKw('publish').start;
    const pipeline = this.ident('a pipeline name');
    this.expectKw('to');
    let visibility: 'public' | 'restricted';
    if (this.eatKw('public')) visibility = 'public';
    else if (this.eatKw('restricted')) visibility = 'restricted';
    else this.fail("'public' or 'restricted'");
    const path = this.string('an output path in double quotes');
    return { kind: 'publish', pipeline, visibility, path, span: { start, end: this.prevEnd() } };
  }

  // ---- steps ----

  private step(): A.Step {
    const t = this.tok;
    if (t.kind !== 'keyword' || !STEP_STARTS.has(t.text)) {
      this.fail('a pipeline step (from, join, where, let, select, group, order or limit)');
    }
    const start = t.start;
    switch (t.text) {
      case 'from': {
        this.next();
        const relation = this.ident('a source or pipeline name');
        return { kind: 'from', relation, span: { start, end: this.prevEnd() } };
      }
      case 'left':
      case 'join':
        return this.joinStep();
      case 'where': {
        this.next();
        const predicate = this.expr();
        return { kind: 'where', predicate, span: { start, end: this.prevEnd() } };
      }
      case 'let': {
        this.next();
        const name = this.ident('a column name');
        this.expectSym('=');
        const value = this.expr();
        return { kind: 'let', name, value, span: { start, end: this.prevEnd() } };
      }
      case 'select': {
        this.next();
        const items: A.SelectItem[] = [this.selectItem()];
        while (this.eatSym(',')) items.push(this.selectItem());
        return { kind: 'select', items, span: { start, end: this.prevEnd() } };
      }
      case 'group':
        return this.groupStep();
      case 'order': {
        this.next();
        this.expectKw('by');
        const keys: A.OrderStep['keys'] = [];
        do {
          const column = this.ref();
          let descending = false;
          if (this.eatKw('desc')) descending = true;
          else this.eatKw('asc');
          keys.push({ column, descending });
        } while (this.eatSym(','));
        return { kind: 'order', keys, span: { start, end: this.prevEnd() } };
      }
      default: {
        this.next(); // limit
        if (!this.at('int')) this.fail('a whole number');
        const count = Number(this.next().text);
        return { kind: 'limit', count, span: { start, end: this.prevEnd() } };
      }
    }
  }

  private joinStep(): A.JoinStep {
    const start = this.tok.start;
    const outer = this.eatKw('left') !== null;
    this.expectKw('join');
    const manyTok = this.eatKw('many');
    const relation = this.ident('a source or pipeline name');
    this.expectKw('on');
    const on: A.JoinCondition[] = [];
    do {
      const left = this.ref();
      this.expectSym('=');
      const right = this.ref();
      on.push({ left, right, span: { start: left.span.start, end: right.span.end } });
    } while (this.eatKw('and'));
    return {
      kind: 'join',
      outer,
      many: manyTok !== null,
      manySpan: manyTok ? { start: manyTok.start, end: manyTok.end } : null,
      relation,
      on,
      span: { start, end: this.prevEnd() },
    };
  }

  private groupStep(): A.GroupStep {
    const start = this.expectKw('group').start;
    const keys: A.RefExpr[] = [];
    if (this.eatKw('by')) {
      keys.push(this.ref());
      while (this.eatSym(',')) keys.push(this.ref());
    }
    this.expectSym('{');
    const aggregates: A.GroupStep['aggregates'] = [];
    while (!this.atSym('}')) {
      const name = this.ident('an output column name');
      this.expectSym('=');
      const value = this.expr();
      aggregates.push({ name, value, span: { start: name.span.start, end: this.prevEnd() } });
      if (!this.eatSym(',')) break;
    }
    this.expectSym('}');
    return { kind: 'group', keys, aggregates, span: { start, end: this.prevEnd() } };
  }

  private selectItem(): A.SelectItem {
    const start = this.tok.start;
    // `name = expr` when an identifier is directly followed by `=`.
    const after = this.tokens[this.pos + 1];
    if (this.at('ident') && after && after.kind === 'symbol' && after.text === '=') {
      const name = this.ident('a column name');
      this.next();
      const value = this.expr();
      return { name, value, span: { start, end: this.prevEnd() } };
    }
    const value = this.ref();
    return { name: null, value, span: { start, end: this.prevEnd() } };
  }

  private ref(): A.RefExpr {
    const first = this.ident('a column name');
    if (this.eatSym('.')) {
      const name = this.ident('a column name');
      return { kind: 'ref', qualifier: first, name, span: { start: first.span.start, end: name.span.end } };
    }
    return { kind: 'ref', qualifier: null, name: first, span: first.span };
  }

  // ---- expressions (lowest to highest precedence) ----
  //   or < and < not < comparison / is null < + - < * / < ?? < unary -

  private expr(): A.Expr {
    return this.orExpr();
  }

  private binary(op: A.BinaryOp, left: A.Expr, right: A.Expr): A.BinaryExpr {
    return { kind: 'binary', op, left, right, span: { start: left.span.start, end: right.span.end } };
  }

  private orExpr(): A.Expr {
    let left = this.andExpr();
    while (this.eatKw('or')) left = this.binary('or', left, this.andExpr());
    return left;
  }

  private andExpr(): A.Expr {
    let left = this.notExpr();
    while (this.eatKw('and')) left = this.binary('and', left, this.notExpr());
    return left;
  }

  private notExpr(): A.Expr {
    const t = this.eatKw('not');
    if (t) {
      const operand = this.notExpr();
      return { kind: 'unary', op: 'not', operand, span: { start: t.start, end: operand.span.end } };
    }
    return this.comparison();
  }

  private comparison(): A.Expr {
    const left = this.additive();
    if (this.eatKw('is')) {
      const negated = this.eatKw('not') !== null;
      this.expectKw('null');
      return { kind: 'isnull', operand: left, negated, span: { start: left.span.start, end: this.prevEnd() } };
    }
    for (const op of ['=', '!=', '<=', '>=', '<', '>'] as const) {
      if (this.eatSym(op)) return this.binary(op, left, this.additive());
    }
    return left;
  }

  private additive(): A.Expr {
    let left = this.multiplicative();
    for (;;) {
      if (this.eatSym('+')) left = this.binary('+', left, this.multiplicative());
      else if (this.eatSym('-')) left = this.binary('-', left, this.multiplicative());
      else return left;
    }
  }

  private multiplicative(): A.Expr {
    let left = this.coalesce();
    for (;;) {
      if (this.eatSym('*')) left = this.binary('*', left, this.coalesce());
      else if (this.eatSym('/')) left = this.binary('/', left, this.coalesce());
      else return left;
    }
  }

  // `??` binds tighter than arithmetic so `amount - discount ?? 0 USD`
  // means `amount - (discount ?? 0 USD)`.
  private coalesce(): A.Expr {
    let left = this.unary();
    while (this.eatSym('??')) left = this.binary('??', left, this.unary());
    return left;
  }

  private unary(): A.Expr {
    const t = this.eatSym('-');
    if (t) {
      const operand = this.unary();
      return { kind: 'unary', op: '-', operand, span: { start: t.start, end: operand.span.end } };
    }
    return this.primary();
  }

  private primary(): A.Expr {
    const t = this.tok;
    const span: Span = { start: t.start, end: t.end };

    if (t.kind === 'int' || t.kind === 'float') {
      this.next();
      // A unit is an identifier on the same line directly after the number: `5 USD`.
      let unit: A.Ident | null = null;
      if (this.at('ident') && this.tok.line === t.line) unit = this.ident('a unit');
      return { kind: 'number', value: Number(t.text), isFloat: t.kind === 'float', unit, span: { start: t.start, end: this.prevEnd() } };
    }
    if (t.kind === 'string') {
      this.next();
      return { kind: 'string', value: t.text, span };
    }
    if (t.kind === 'date') {
      this.next();
      return { kind: 'date', value: t.text, span };
    }
    if (this.eatKw('true')) return { kind: 'bool', value: true, span };
    if (this.eatKw('false')) return { kind: 'bool', value: false, span };
    if (this.eatSym('(')) {
      const inner = this.expr();
      this.expectSym(')');
      return inner;
    }
    if (t.kind === 'ident') {
      const after = this.tokens[this.pos + 1];
      if (after && after.kind === 'symbol' && after.text === '(') {
        const callee = this.ident('a function name');
        this.next();
        const args: A.Expr[] = [];
        if (!this.atSym(')')) {
          args.push(this.expr());
          while (this.eatSym(',')) args.push(this.expr());
        }
        this.expectSym(')');
        return { kind: 'call', callee, args, span: { start: t.start, end: this.prevEnd() } };
      }
      return this.ref();
    }
    this.fail('an expression');
  }
}
