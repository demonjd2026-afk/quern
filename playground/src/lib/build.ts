// Runs the real compiler and interpreter in the page. Nothing is sent anywhere.

import { RuntimeError, compile, run } from '../../../src/index.ts';
import type { CompileResult, Row } from '../../../src/index.ts';
import customers from '../../../examples/shop/data/customers.csv?raw';
import orderItems from '../../../examples/shop/data/order_items.csv?raw';
import orders from '../../../examples/shop/data/orders.csv?raw';
import products from '../../../examples/shop/data/products.csv?raw';

export type Files = Readonly<Record<string, string>>;

export const SAMPLE_FILES: Files = {
  'data/customers.csv': customers,
  'data/orders.csv': orders,
  'data/order_items.csv': orderItems,
  'data/products.csv': products,
};

/** Limits on data a reader adds, so a stray paste cannot freeze the tab. */
export const MAX_FILES = 8;
export const MAX_FILE_BYTES = 200_000;

export interface Build {
  result: CompileResult;
  errors: number;
  warnings: number;
  /** Rows of every pipeline, when the program compiled and ran. */
  tables: Map<string, Row[]> | null;
  /** Set when the program type-checks but the data breaks a source declaration. */
  dataError: { code: string; message: string } | null;
  /** True when anything stops the program producing rows. */
  blocked: boolean;
  /** Compiler diagnostics plus the data error, if there is one. */
  findings: number;
  millis: number;
}

export function build(source: string, files: Files): Build {
  const started = performance.now();
  const result = compile(source);
  const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = result.diagnostics.length - errors;
  let tables: Map<string, Row[]> | null = null;
  let dataError: Build['dataError'] = null;
  if (result.program) {
    try {
      tables = run(result.program, {
        readSource: (path) => {
          const file = files[path];
          if (file === undefined) {
            throw new RuntimeError('R0003', `there is no file "${path}". Open the Data tab to see the files, or add this one.`);
          }
          return file;
        },
      });
    } catch (e) {
      if (!(e instanceof RuntimeError)) throw e;
      dataError = { code: e.code, message: e.message };
    }
  }
  return {
    result,
    errors,
    warnings,
    tables,
    dataError,
    blocked: errors > 0 || dataError !== null,
    findings: result.diagnostics.length + (dataError ? 1 : 0),
    millis: performance.now() - started,
  };
}
