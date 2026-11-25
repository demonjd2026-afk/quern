// The type checker. It walks each pipeline step by step, carrying a relation
// type forward, and lowers the AST to typed IR. Four facts ride along with the
// ordinary base types:
//
//   nullability  a nullable value must be handled before it is compared,
//                filtered on, joined on, or aggregated
//   keys         which column sets are unique per row; this decides whether a
//                join can multiply rows and which columns it duplicates
//   pii          explicit-flow taint from columns marked `pii`
//   units        units of measure on numbers (USD, ms, ...)

import type * as A from './ast.ts';
import type { Diagnostics, Span } from './diagnostics.ts';
import { showType } from './ir.ts';
import type { AggregateFn, ColType, Column, Dependency, Relation, ScalarFn, TExpr, TItem, TProgram, TStep } from './ir.ts';

const AGGREGATES: ReadonlySet<string> = new Set(['sum', 'avg', 'min', 'max', 'count', 'count_distinct']);
const SCALARS: ReadonlySet<string> = new Set(['hash', 'lower', 'upper', 'abs', 'round', 'convert']);

const isNumeric = (t: ColType): boolean => t.base === 'int' || t.base === 'float';
const plain = (base: ColType['base']): ColType => ({ base, nullable: false, unit: null, pii: false });

export function check(program: A.Program, diags: Diagnostics): TProgram {
  return new Checker(diags).run(program);
}

/** Thrown to abandon the current pipeline after an error that would only cascade. */
class Abort extends Error {}

class Checker {
  private readonly diags: Diagnostics;
  private readonly relations = new Map<string, Relation>();
  private readonly pipelines = new Set<string>();
  /** Names that failed to check; references to them are not reported again. */
  private readonly broken = new Set<string>();
  /** Why each column of the pipeline being checked is duplicated, for error text. */
  private dupReason = new Map<string, string>();

  constructor(diags: Diagnostics) {
    this.diags = diags;
  }

  run(program: A.Program): TProgram {
    // Sources are hoisted: they may be declared anywhere in the file, so a
    // program can lead with its pipelines. Pipelines must be defined before use.
    const items: TItem[] = [];
    for (const decl of program.decls) {
      if (decl.kind !== 'source') continue;
      const item = this.source(decl);
      if (item) items.push(item);
    }
    for (const decl of program.decls) {
      if (decl.kind === 'source') continue;
      const item = decl.kind === 'pipeline' ? this.pipeline(decl) : this.publish(decl);
      if (item) items.push(item);
    }
    return { items };
  }

  // ---- declarations ----

  private declareName(name: A.Ident): boolean {
    if (this.relations.has(name.name) || this.broken.has(name.name)) {
      this.diags.error('E0104', name.span, `'${name.name}' is already defined`);
      return false;
    }
    return true;
  }

  private source(decl: A.SourceDecl): TItem | null {
    if (!this.declareName(decl.name)) return null;
    let ok = true;
    const columns: Column[] = [];
    const keys: string[][] = [];
    for (const c of decl.columns) {
      if (columns.some((x) => x.name === c.name.name)) {
        this.diags.error('E0104', c.name.span, `column '${c.name.name}' is declared twice`);
        ok = false;
        continue;
      }
      if (c.unit && c.base !== 'int' && c.base !== 'float') {
        this.diags.error('E0502', c.unit.span, `only int and float columns can carry a unit, not ${c.base}`);
        ok = false;
      }
      if (c.key && c.nullable) {
        this.diags.error('E0201', c.span, `key column '${c.name.name}' cannot be nullable`, 'a key identifies a row, so it must always have a value');
        ok = false;
      }
      columns.push({
        name: c.name.name,
        type: { base: c.base, nullable: c.nullable, unit: c.unit?.name ?? null, pii: c.pii },
        duplicated: false,
        origins: [decl.name.name],
      });
      if (c.key) keys.push([c.name.name]);
    }
    for (const composite of decl.compositeKeys) {
      const names: string[] = [];
      for (const id of composite) {
        const col = columns.find((x) => x.name === id.name);
        if (!col) {
          this.diags.error('E0101', id.span, `key refers to unknown column '${id.name}'`, suggest(id.name, columns.map((x) => x.name)));
          ok = false;
        } else if (col.type.nullable) {
          this.diags.error('E0201', id.span, `key column '${id.name}' cannot be nullable`);
          ok = false;
        } else if (!names.includes(id.name)) {
          names.push(id.name);
        }
      }
      keys.push(names);
    }
    if (!ok) {
      this.broken.add(decl.name.name);
      return null;
    }
    const relation: Relation = { columns, keys: dedupeKeys(keys), dependencies: [] };
    this.relations.set(decl.name.name, relation);
    return { kind: 'source', name: decl.name.name, path: decl.path.value, relation };
  }

  private publish(decl: A.PublishDecl): TItem | null {
    const rel = this.relations.get(decl.pipeline.name);
    if (!rel || !this.pipelines.has(decl.pipeline.name)) {
      if (!this.broken.has(decl.pipeline.name)) {
        this.diags.error('E0102', decl.pipeline.span, `unknown pipeline '${decl.pipeline.name}'`, suggest(decl.pipeline.name, [...this.pipelines]));
      }
      return null;
    }
    let ok = true;
    if (decl.visibility === 'public') {
      for (const c of rel.columns) {
        if (c.type.pii) {
          this.diags.error(
            'E0401',
            decl.pipeline.span,
            `column '${c.name}' of '${decl.pipeline.name}' carries PII and cannot be published to a public sink`,
            `wrap it in hash(...), leave it out with select, or publish to restricted`,
          );
          ok = false;
        }
      }
    }
    if (!ok) return null;
    return { kind: 'publish', pipeline: decl.pipeline.name, visibility: decl.visibility, path: decl.path.value };
  }

  private pipeline(decl: A.PipelineDecl): TItem | null {
    if (!this.declareName(decl.name)) return null;
    const before = this.diags.items.filter((d) => d.severity === 'error').length;
    this.dupReason = new Map();
    let steps: TStep[] | null = null;
    try {
      steps = this.steps(decl);
    } catch (e) {
      if (!(e instanceof Abort)) throw e;
    }
    const after = this.diags.items.filter((d) => d.severity === 'error').length;
    if (!steps || after > before) {
      this.broken.add(decl.name.name);
      return null;
    }
    const last = steps[steps.length - 1]!.out;
    // Downstream readers qualify these columns with the pipeline's own name.
    const relation: Relation = {
      columns: last.columns.map((c) => ({ ...c, origins: [decl.name.name] })),
      keys: last.keys,
      dependencies: last.dependencies,
    };
    this.relations.set(decl.name.name, relation);
    this.pipelines.add(decl.name.name);
    return { kind: 'pipeline', name: decl.name.name, steps, relation };
  }

  // ---- steps ----

  private steps(decl: A.PipelineDecl): TStep[] {
    const first = decl.steps[0];
    if (!first || first.kind !== 'from') {
      this.diags.error('E0108', first?.span ?? decl.name.span, `pipeline '${decl.name.name}' must start with a from step`);
      throw new Abort();
    }
    const out: TStep[] = [];
    let rel = this.fromStep(first);
    out.push({ kind: 'from', relation: first.relation.name, out: rel });

    for (let i = 1; i < decl.steps.length; i++) {
      const step = decl.steps[i]!;
      switch (step.kind) {
        case 'from':
          this.diags.error('E0108', step.span, 'a pipeline can have only one from step', 'use join to bring in another relation');
          throw new Abort();
        case 'join': {
          const t = this.joinStep(step, rel);
          out.push(t);
          rel = t.out;
          break;
        }
        case 'where': {
          const predicate = this.expr(step.predicate, rel);
          if (!predicate) break;
          if (!this.requireBool(predicate, step.predicate.span, 'a where condition')) break;
          rel = narrow(rel, predicate);
          out.push({ kind: 'where', predicate, out: rel });
          break;
        }
        case 'let': {
          const value = this.expr(step.value, rel);
          if (rel.columns.some((c) => c.name === step.name.name)) {
            this.diags.error('E0104', step.name.span, `column '${step.name.name}' already exists`, 'pick a new name; columns are never overwritten');
            throw new Abort();
          }
          if (!value) throw new Abort();
          const duplicated = this.isDuplicated(value, rel);
          if (duplicated) this.dupReason.set(step.name.name, this.reasonFor(value));
          rel = {
            columns: [...rel.columns, { name: step.name.name, type: value.type, duplicated, origins: [] }],
            keys: rel.keys,
            dependencies: rel.dependencies,
          };
          out.push({ kind: 'let', name: step.name.name, value, out: rel });
          break;
        }
        case 'select': {
          const t = this.selectStep(step, rel);
          out.push(t);
          rel = t.out;
          break;
        }
        case 'group': {
          const t = this.groupStep(step, rel);
          out.push(t);
          rel = t.out;
          break;
        }
        case 'order': {
          const keys: { column: string; descending: boolean }[] = [];
          for (const k of step.keys) {
            const col = this.resolve(rel, k.column);
            if (col) keys.push({ column: col.name, descending: k.descending });
          }
          const next = decl.steps[i + 1];
          let limit: number | null = null;
          if (next && next.kind === 'limit') {
            limit = next.count;
            i++;
            const ordered = keys.map((k) => k.column);
            if (!rel.keys.some((key) => key.every((c) => ordered.includes(c)))) {
              this.diags.warn(
                'W0601',
                next.span,
                'rows that tie on the order columns make this limit pick arbitrary rows',
                rel.keys.length > 0 ? `add a key to the order by, for example ${rel.keys[0]!.join(', ') || 'any column'}` : 'order by columns that identify a row uniquely',
              );
            }
          } else if (next) {
            this.diags.error('E0602', step.span, 'order by must be the last step or be followed by limit', 'later steps do not preserve row order; move order by to the end');
          }
          out.push({ kind: 'order', keys, limit, out: rel });
          break;
        }
        case 'limit':
          this.diags.error('E0601', step.span, 'limit needs an order by directly before it', 'without an order, which rows are kept is arbitrary');
          break;
      }
    }
    return out;
  }

  private fromStep(step: A.FromStep): Relation {
    const rel = this.lookup(step.relation);
    return { columns: rel.columns.map((c) => ({ ...c, origins: [step.relation.name] })), keys: rel.keys, dependencies: rel.dependencies };
  }

  private lookup(name: A.Ident): Relation {
    const rel = this.relations.get(name.name);
    if (!rel) {
      if (!this.broken.has(name.name)) {
        this.diags.error('E0102', name.span, `unknown source or pipeline '${name.name}'`, suggest(name.name, [...this.relations.keys()]));
      }
      throw new Abort();
    }
    for (const c of rel.columns) {
      if (c.duplicated && !this.dupReason.has(c.name)) this.dupReason.set(c.name, `a join inside '${name.name}' repeats its rows`);
    }
    return rel;
  }

  private joinStep(step: A.JoinStep, left: Relation): TStep {
    const rightName = step.relation.name;
    const source = this.lookup(step.relation);
    const right: Relation = { columns: source.columns.map((c) => ({ ...c, origins: [rightName] })), keys: source.keys, dependencies: source.dependencies };

    const on: { left: string; right: string }[] = [];
    let ok = true;
    for (const cond of step.on) {
      const a = this.joinSide(cond.left, left, right, rightName);
      const b = this.joinSide(cond.right, left, right, rightName);
      if (!a || !b) {
        ok = false;
        continue;
      }
      if (a.side === b.side) {
        const where = a.side === 'left' ? 'the pipeline so far' : `'${rightName}'`;
        this.diags.error('E0108', cond.span, `both sides of this join condition come from ${where}`, `compare a column of the pipeline with a column of '${rightName}', written ${rightName}.column`);
        ok = false;
        continue;
      }
      const l = a.side === 'left' ? a : b;
      const r = a.side === 'left' ? b : a;
      if (l.col.type.base !== r.col.type.base) {
        this.diags.error('E0103', cond.span, `cannot join ${showType(l.col.type)} with ${showType(r.col.type)}`);
        ok = false;
      } else if (l.col.type.unit !== r.col.type.unit) {
        this.diags.error('E0501', cond.span, `join columns have different units: ${showType(l.col.type)} and ${showType(r.col.type)}`);
        ok = false;
      }
      for (const side of [l, r]) {
        if (side.col.type.nullable) {
          this.diags.error(
            'E0203',
            side.ref.span,
            `join column '${side.col.name}' is nullable; rows where it is null never match and would silently disappear`,
            `filter first with \`where ${side.col.name} is not null\`, or give it a default with ??`,
          );
          ok = false;
        }
      }
      on.push({ left: l.col.name, right: r.col.name });
    }
    if (!ok) throw new Abort();

    const leftCols = on.map((p) => p.left);
    const rightCols = on.map((p) => p.right);
    const covers = (keys: string[][], cols: string[]): boolean => keys.some((k) => k.every((c) => cols.includes(c)));
    const rightUnique = covers(right.keys, rightCols); // each input row matches at most one right row
    const leftUnique = covers(left.keys, leftCols); // each right row matches at most one input row

    if (!rightUnique && !step.many) {
      const keyText = right.keys.length > 0 ? `its keys are ${right.keys.map((k) => `(${k.join(', ')})`).join(', ')}` : 'it declares no key';
      this.diags.error(
        'E0300',
        step.relation.span,
        `this join can multiply rows: (${rightCols.join(', ')}) is not a key of '${rightName}'`,
        `${keyText}. Join on a key, or write \`join many ${rightName}\` to accept one output row per match`,
      );
    }
    if (rightUnique && step.many && step.manySpan) {
      this.diags.warn('W0300', step.manySpan, `\`many\` is not needed: (${rightCols.join(', ')}) is a key of '${rightName}', so each row matches at most once`);
    }

    const columns: Column[] = left.columns.map((c) => {
      const dup = c.duplicated || !rightUnique;
      if (dup && !c.duplicated) this.dupReason.set(c.name, `the join with '${rightName}' can repeat each row of the left-hand side`);
      return { ...c, duplicated: dup };
    });
    const kept: string[] = [];
    for (const c of right.columns) {
      const clash = columns.find((x) => x.name === c.name);
      if (clash) {
        if (on.some((p) => p.left === c.name && p.right === c.name)) {
          // Same-named join key: keep one copy, reachable under both qualifiers.
          clash.origins = [...clash.origins, rightName];
          continue;
        }
        this.diags.error(
          'E0104',
          step.relation.span,
          `column '${c.name}' exists on both sides of the join`,
          `rename one side first in its own pipeline, e.g. select ${rightName}_${c.name} = ${c.name}`,
        );
        ok = false;
        continue;
      }
      const dup = c.duplicated || !leftUnique;
      if (dup && !c.duplicated) this.dupReason.set(c.name, `the join repeats each '${rightName}' row once per matching input row`);
      columns.push({
        name: c.name,
        type: { ...c.type, nullable: c.type.nullable || step.outer },
        duplicated: dup,
        origins: [rightName],
      });
      kept.push(c.name);
    }
    if (!ok) throw new Abort();

    let keys: string[][];
    const products = (): string[][] => left.keys.flatMap((lk) => right.keys.map((rk) => [...new Set([...lk, ...rk])]));
    if (rightUnique && (step.outer || !leftUnique)) keys = left.keys;
    else if (rightUnique) keys = [...left.keys, ...right.keys];
    else if (leftUnique && !step.outer) keys = right.keys;
    else keys = products();

    // A to-one join makes every right-hand column a function of the join columns.
    const dependencies: Dependency[] = [...left.dependencies, ...right.dependencies];
    if (rightUnique && kept.length > 0) dependencies.push({ from: leftCols, to: kept });

    return {
      kind: 'join',
      outer: step.outer,
      relation: rightName,
      on,
      rightColumns: kept,
      out: { columns, keys: dedupeKeys(keys), dependencies },
    };
  }

  private joinSide(ref: A.RefExpr, left: Relation, right: Relation, rightName: string): { side: 'left' | 'right'; col: Column; ref: A.RefExpr } | null {
    if (ref.qualifier && ref.qualifier.name === rightName) {
      const col = right.columns.find((c) => c.name === ref.name.name);
      if (!col) {
        this.diags.error('E0101', ref.name.span, `'${rightName}' has no column '${ref.name.name}'`, suggest(ref.name.name, right.columns.map((c) => c.name)));
        return null;
      }
      return { side: 'right', col, ref };
    }
    const inLeft = find(left, ref);
    if (inLeft) return { side: 'left', col: inLeft, ref };
    if (!ref.qualifier) {
      const inRight = right.columns.find((c) => c.name === ref.name.name);
      if (inRight) return { side: 'right', col: inRight, ref };
    }
    this.resolve(left, ref); // reports the unknown-column error
    return null;
  }

  private selectStep(step: A.SelectStep, rel: Relation): TStep {
    const items: { name: string; value: TExpr }[] = [];
    const columns: Column[] = [];
    const renamed = new Map<string, string>(); // input column -> output column
    let ok = true;
    for (const item of step.items) {
      let name: string;
      let value: TExpr | null;
      let column: Column | null = null;
      if (item.name === null) {
        const col = this.resolve(rel, item.value as A.RefExpr);
        if (!col) {
          ok = false;
          continue;
        }
        name = col.name;
        value = { kind: 'column', name: col.name, type: col.type };
        column = { ...col };
      } else {
        name = item.name.name;
        value = this.expr(item.value, rel);
        if (!value) {
          ok = false;
          continue;
        }
        const duplicated = this.isDuplicated(value, rel);
        if (duplicated) this.dupReason.set(name, this.reasonFor(value));
        column = { name, type: value.type, duplicated, origins: [] };
      }
      if (columns.some((c) => c.name === name)) {
        this.diags.error('E0104', item.span, `column '${name}' appears twice in this select`);
        ok = false;
        continue;
      }
      if (value.kind === 'column' && !renamed.has(value.name)) renamed.set(value.name, name);
      columns.push(column);
      items.push({ name, value });
    }
    if (!ok) throw new Abort();
    const keys = rel.keys.filter((k) => k.every((c) => renamed.has(c))).map((k) => k.map((c) => renamed.get(c)!));
    const dependencies = rel.dependencies
      .filter((d) => d.from.every((c) => renamed.has(c)))
      .map((d) => ({ from: d.from.map((c) => renamed.get(c)!), to: d.to.flatMap((c) => (renamed.has(c) ? [renamed.get(c)!] : [])) }))
      .filter((d) => d.to.length > 0);
    return { kind: 'select', items, out: { columns, keys: dedupeKeys(keys), dependencies } };
  }

  private groupStep(step: A.GroupStep, rel: Relation): TStep {
    let ok = true;
    const keys: string[] = [];
    const columns: Column[] = [];
    for (const k of step.keys) {
      const col = this.resolve(rel, k);
      if (!col) {
        ok = false;
      } else if (keys.includes(col.name)) {
        this.diags.error('E0104', k.span, `'${col.name}' is listed twice in group by`);
        ok = false;
      } else {
        keys.push(col.name);
        columns.push({ ...col, duplicated: false });
      }
    }
    const global = step.keys.length === 0;
    const aggregates: { name: string; fn: AggregateFn; arg: TExpr | null; type: ColType }[] = [];
    for (const agg of step.aggregates) {
      const call = agg.value;
      if (call.kind !== 'call' || !AGGREGATES.has(call.callee.name)) {
        this.diags.error('E0106', agg.value.span, 'a group output must be a single aggregate call', 'for example total = sum(amount); compute ratios in a let step after the group');
        ok = false;
        continue;
      }
      const fn = call.callee.name as AggregateFn;
      const wanted = fn === 'count' ? 0 : 1;
      if (call.args.length !== wanted) {
        this.diags.error('E0106', call.span, `${fn} takes ${wanted === 0 ? 'no arguments' : 'exactly one argument'}`, fn === 'count' ? 'count() counts rows; use count_distinct(x) to count distinct values' : undefined);
        ok = false;
        continue;
      }
      let arg: TExpr | null = null;
      let type: ColType = plain('int');
      if (fn !== 'count') {
        arg = this.expr(call.args[0]!, rel);
        if (!arg) {
          ok = false;
          continue;
        }
        const argSpan = call.args[0]!.span;
        const t = arg.type;
        if ((fn === 'sum' || fn === 'avg') && !isNumeric(t)) {
          this.diags.error('E0103', argSpan, `${fn} needs a number, found ${showType(t)}`);
          ok = false;
        }
        if ((fn === 'min' || fn === 'max') && t.base === 'bool') {
          this.diags.error('E0103', argSpan, `${fn} is not defined for bool`);
          ok = false;
        }
        if (t.nullable) {
          this.diags.error(
            'E0202',
            argSpan,
            `${fn} would silently skip the rows where this value is null`,
            fn === 'avg' || fn === 'min' || fn === 'max'
              ? 'decide explicitly: filter with `where x is not null` to leave them out, or give a default with ??'
              : 'give a default with ??, e.g. sum(x ?? 0), or filter with `where x is not null`',
          );
          ok = false;
        }
        if ((fn === 'sum' || fn === 'avg') && this.isDuplicated(arg, rel)) {
          this.diags.error(
            'E0301',
            argSpan,
            `${fn} would count the same values more than once: ${this.reasonFor(arg)}`,
            'aggregate this column before the join, or use an expression that includes a column at the current grain',
          );
          ok = false;
        }
        if (fn === 'sum') type = { base: t.base, nullable: global, unit: t.unit, pii: t.pii };
        else if (fn === 'avg') type = { base: 'float', nullable: global, unit: t.unit, pii: t.pii };
        else if (fn === 'min' || fn === 'max') type = { base: t.base, nullable: global, unit: t.unit, pii: t.pii };
        else type = plain('int');
      }
      if (columns.some((c) => c.name === agg.name.name)) {
        this.diags.error('E0104', agg.name.span, `column '${agg.name.name}' appears twice in this group`);
        ok = false;
        continue;
      }
      columns.push({ name: agg.name.name, type, duplicated: false, origins: [] });
      aggregates.push({ name: agg.name.name, fn, arg, type });
    }
    if (!ok) throw new Abort();
    // The grouped relation is unique on its group columns. Columns that are a
    // function of the others (title given product_id) are not needed in the key.
    const minimal = [...keys];
    for (let i = minimal.length - 1; i >= 0; i--) {
      const candidate = minimal[i]!;
      const others = minimal.filter((c) => c !== candidate);
      if (rel.dependencies.some((d) => d.to.includes(candidate) && d.from.every((c) => others.includes(c)))) minimal.splice(i, 1);
    }
    const dependencies = rel.dependencies
      .filter((d) => d.from.every((c) => keys.includes(c)))
      .map((d) => ({ from: d.from, to: d.to.filter((c) => keys.includes(c)) }))
      .filter((d) => d.to.length > 0);
    return { kind: 'group', keys, aggregates, out: { columns, keys: [minimal], dependencies } };
  }

  // ---- expressions ----

  private resolve(rel: Relation, ref: A.RefExpr): Column | null {
    const col = find(rel, ref);
    if (col) return col;
    const names = rel.columns.map((c) => c.name);
    if (ref.qualifier && names.includes(ref.name.name)) {
      this.diags.error('E0101', ref.span, `column '${ref.name.name}' does not come from '${ref.qualifier.name}'`, `write it without the qualifier: ${ref.name.name}`);
    } else {
      this.diags.error('E0101', ref.name.span, `unknown column '${ref.name.name}'`, suggest(ref.name.name, names) ?? `available columns: ${names.join(', ')}`);
    }
    return null;
  }

  private requireBool(e: TExpr, span: Span, what: string): boolean {
    if (e.type.base !== 'bool') {
      this.diags.error('E0103', span, `${what} must be a bool, found ${showType(e.type)}`);
      return false;
    }
    if (e.type.nullable) {
      this.diags.error('E0201', span, `${what} may be null, which SQL treats as false and silently drops the row`, 'give it a default with ??, e.g. flag ?? false');
      return false;
    }
    return true;
  }

  private isDuplicated(e: TExpr, rel: Relation): boolean {
    const refs = columnsOf(e);
    return refs.length > 0 && refs.every((n) => rel.columns.find((c) => c.name === n)?.duplicated === true);
  }

  private reasonFor(e: TExpr): string {
    const first = columnsOf(e)[0];
    return (first !== undefined ? this.dupReason.get(first) : undefined) ?? 'an earlier join repeats its rows';
  }

  private expr(e: A.Expr, rel: Relation): TExpr | null {
    switch (e.kind) {
      case 'number':
        return { kind: 'literal', value: e.value, type: { ...plain(e.isFloat ? 'float' : 'int'), unit: e.unit?.name ?? null } };
      case 'string':
        return { kind: 'literal', value: e.value, type: plain('text') };
      case 'bool':
        return { kind: 'literal', value: e.value, type: plain('bool') };
      case 'date':
        return { kind: 'literal', value: e.value, type: plain('date') };
      case 'ref': {
        const col = this.resolve(rel, e);
        return col ? { kind: 'column', name: col.name, type: col.type } : null;
      }
      case 'unary': {
        const operand = this.expr(e.operand, rel);
        if (!operand) return null;
        if (e.op === 'not') {
          if (!this.requireBool(operand, e.operand.span, 'the operand of not')) return null;
          return { kind: 'not', operand, type: operand.type };
        }
        if (!isNumeric(operand.type)) {
          this.diags.error('E0103', e.operand.span, `cannot negate ${showType(operand.type)}`);
          return null;
        }
        return { kind: 'negate', operand, type: operand.type };
      }
      case 'isnull': {
        const operand = this.expr(e.operand, rel);
        if (!operand) return null;
        return { kind: 'isnull', operand, negated: e.negated, type: { ...plain('bool'), pii: operand.type.pii } };
      }
      case 'binary':
        return this.binary(e, rel);
      case 'call':
        return this.call(e, rel);
    }
  }

  private binary(e: A.BinaryExpr, rel: Relation): TExpr | null {
    const left = this.expr(e.left, rel);
    const right = this.expr(e.right, rel);
    if (!left || !right) return null;
    const lt = left.type;
    const rt = right.type;
    const pii = lt.pii || rt.pii;

    switch (e.op) {
      case 'and':
      case 'or': {
        const a = this.requireBool(left, e.left.span, `the left side of ${e.op}`);
        const b = this.requireBool(right, e.right.span, `the right side of ${e.op}`);
        return a && b ? { kind: 'logic', op: e.op, left, right, type: { ...plain('bool'), pii } } : null;
      }
      case '=':
      case '!=':
      case '<':
      case '<=':
      case '>':
      case '>=': {
        if (!comparable(lt, rt) || (lt.base === 'bool' && e.op !== '=' && e.op !== '!=')) {
          this.diags.error('E0103', e.span, `cannot compare ${showType(lt)} with ${showType(rt)} using ${e.op}`);
          return null;
        }
        let ok = true;
        for (const [side, span] of [[left, e.left.span], [right, e.right.span]] as const) {
          if (side.type.nullable) {
            this.diags.error(
              'E0201',
              span,
              'this value may be null; comparing null gives null, and the row silently drops out',
              'give it a default with ??, test it with `is null`, or filter first with `where x is not null`',
            );
            ok = false;
          }
        }
        if (!this.sameUnit(e, left, right, 'compare')) ok = false;
        return ok ? { kind: 'compare', op: e.op, left, right, type: { ...plain('bool'), pii } } : null;
      }
      case '??': {
        if (!comparable(lt, rt)) {
          this.diags.error('E0103', e.span, `the default for ${showType(lt)} cannot be ${showType(rt)}`);
          return null;
        }
        if (!this.sameUnit(e, left, right, 'combine')) return null;
        if (!lt.nullable) this.diags.warn('W0201', e.left.span, 'this value is never null, so the ?? default is never used');
        const base = lt.base === rt.base ? lt.base : 'float';
        return { kind: 'coalesce', left, right, type: { base, nullable: lt.nullable && rt.nullable, unit: lt.unit, pii } };
      }
      default: {
        if (!isNumeric(lt) || !isNumeric(rt)) {
          this.diags.error('E0103', e.span, `cannot apply ${e.op} to ${showType(lt)} and ${showType(rt)}`);
          return null;
        }
        let unit: string | null;
        if (e.op === '+' || e.op === '-') {
          if (!this.sameUnit(e, left, right, e.op === '+' ? 'add' : 'subtract')) return null;
          unit = lt.unit;
        } else if (e.op === '*') {
          if (lt.unit && rt.unit) {
            this.diags.error('E0502', e.span, `cannot multiply ${showType(lt)} by ${showType(rt)}; Quern has no compound units`, 'one side of a multiplication must be a plain number');
            return null;
          }
          unit = lt.unit ?? rt.unit;
        } else {
          if (rt.unit && lt.unit !== rt.unit) {
            this.diags.error('E0502', e.span, `cannot divide ${showType(lt)} by ${showType(rt)}`, 'divide by a plain number, or by a value in the same unit to get a ratio');
            return null;
          }
          unit = rt.unit ? null : lt.unit;
        }
        const base = e.op === '/' || lt.base === 'float' || rt.base === 'float' ? 'float' : 'int';
        // Division by zero yields null rather than an error or infinity, so a
        // quotient is nullable unless the divisor is a non-zero literal.
        const safeDivisor = right.kind === 'literal' && right.value !== 0;
        const nullable = lt.nullable || rt.nullable || (e.op === '/' && !safeDivisor);
        return { kind: 'arith', op: e.op, left, right, type: { base, nullable, unit, pii } };
      }
    }
  }

  private sameUnit(e: A.BinaryExpr, left: TExpr, right: TExpr, verb: string): boolean {
    if (left.type.unit === right.type.unit) return true;
    const bare = left.type.unit === null ? left : right.type.unit === null ? right : null;
    const unit = left.type.unit ?? right.type.unit;
    let hint: string;
    if (bare && bare.kind === 'literal') hint = `write the number with its unit: ${String(bare.value)} ${unit}`;
    else if (bare) hint = `the side without a unit is a plain number; multiply instead, or declare its unit at the source`;
    else hint = `convert one side first, e.g. convert(x, ${left.type.unit}, <rate>)`;
    this.diags.error('E0501', e.span, `cannot ${verb} ${showType(left.type)} and ${showType(right.type)}: the units differ`, hint);
    return false;
  }

  private call(e: A.CallExpr, rel: Relation): TExpr | null {
    const name = e.callee.name;
    if (AGGREGATES.has(name)) {
      this.diags.error('E0107', e.span, `${name} is an aggregate and can only be used as a group output`, `write group by ... { total = ${name}(...) }`);
      return null;
    }
    if (!SCALARS.has(name)) {
      this.diags.error('E0106', e.callee.span, `unknown function '${name}'`, suggest(name, [...SCALARS, ...AGGREGATES]));
      return null;
    }
    const fn = name as ScalarFn;
    const arity = fn === 'convert' ? 3 : fn === 'round' ? 2 : 1;
    if (e.args.length !== arity) {
      this.diags.error('E0106', e.span, `${fn} takes ${arity} argument${arity === 1 ? '' : 's'}, found ${e.args.length}`);
      return null;
    }
    const first = this.expr(e.args[0]!, rel);
    if (!first) return null;
    const t = first.type;
    const bad = (expected: string): null => {
      this.diags.error('E0103', e.args[0]!.span, `${fn} needs ${expected}, found ${showType(t)}`);
      return null;
    };

    switch (fn) {
      case 'hash':
        if (t.base !== 'text' && t.base !== 'int') return bad('text or int');
        // hash is the one-way declassifier: its result no longer carries PII.
        return { kind: 'call', fn, args: [first], type: { base: 'text', nullable: t.nullable, unit: null, pii: false } };
      case 'lower':
      case 'upper':
        if (t.base !== 'text') return bad('text');
        return { kind: 'call', fn, args: [first], type: t };
      case 'abs':
        if (!isNumeric(t)) return bad('a number');
        return { kind: 'call', fn, args: [first], type: t };
      case 'round': {
        if (!isNumeric(t)) return bad('a number');
        const digits = e.args[1]!;
        if (digits.kind !== 'number' || digits.isFloat || digits.unit || digits.value > 15) {
          this.diags.error('E0106', digits.span, 'the second argument of round must be a whole-number literal from 0 to 15');
          return null;
        }
        return { kind: 'call', fn, args: [first, { kind: 'literal', value: digits.value, type: plain('int') }], type: { ...t, base: 'float' } };
      }
      case 'convert': {
        if (!isNumeric(t)) return bad('a number');
        if (!t.unit) {
          this.diags.error('E0502', e.args[0]!.span, 'convert needs a value that has a unit', 'a plain number has nothing to convert from');
          return null;
        }
        const target = e.args[1]!;
        if (target.kind !== 'ref' || target.qualifier) {
          this.diags.error('E0106', target.span, 'the second argument of convert must be a unit name, e.g. convert(amount, INR, 83.2)');
          return null;
        }
        const rate = this.expr(e.args[2]!, rel);
        if (!rate) return null;
        if (!isNumeric(rate.type) || rate.type.unit) {
          this.diags.error('E0103', e.args[2]!.span, `the conversion rate must be a plain number, found ${showType(rate.type)}`);
          return null;
        }
        return {
          kind: 'call',
          fn,
          args: [first, rate],
          type: { base: 'float', nullable: t.nullable || rate.type.nullable, unit: target.name.name, pii: t.pii || rate.type.pii },
        };
      }
    }
  }
}

// ---- helpers ----

function find(rel: Relation, ref: A.RefExpr): Column | null {
  const col = rel.columns.find((c) => c.name === ref.name.name);
  if (!col) return null;
  if (ref.qualifier && !col.origins.includes(ref.qualifier.name)) return null;
  return col;
}

function comparable(a: ColType, b: ColType): boolean {
  return a.base === b.base || (isNumeric(a) && isNumeric(b));
}

export function columnsOf(e: TExpr): string[] {
  switch (e.kind) {
    case 'column':
      return [e.name];
    case 'literal':
      return [];
    case 'arith':
    case 'compare':
    case 'logic':
    case 'coalesce':
      return [...columnsOf(e.left), ...columnsOf(e.right)];
    case 'not':
    case 'negate':
    case 'isnull':
      return columnsOf(e.operand);
    case 'call':
      return e.args.flatMap(columnsOf);
  }
}

/** Flow-sensitive narrowing: after `where x is not null`, x is no longer nullable. */
function narrow(rel: Relation, predicate: TExpr): Relation {
  const proven = new Set<string>();
  const visit = (e: TExpr): void => {
    if (e.kind === 'logic' && e.op === 'and') {
      visit(e.left);
      visit(e.right);
    } else if (e.kind === 'isnull' && e.negated && e.operand.kind === 'column') {
      proven.add(e.operand.name);
    }
  };
  visit(predicate);
  if (proven.size === 0) return rel;
  return {
    columns: rel.columns.map((c) => (proven.has(c.name) ? { ...c, type: { ...c.type, nullable: false } } : c)),
    keys: rel.keys,
    dependencies: rel.dependencies,
  };
}

function dedupeKeys(keys: string[][]): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const k of keys) {
    const id = [...k].sort().join('\u0000');
    if (!seen.has(id)) {
      seen.add(id);
      out.push(k);
    }
  }
  return out;
}

/** "did you mean" for names within a small edit distance. */
function suggest(name: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Math.max(2, Math.floor(name.length / 3)) + 1;
  for (const c of candidates) {
    const d = editDistance(name, c);
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best === undefined ? undefined : `did you mean '${best}'?`;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}
