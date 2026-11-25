// The playground drafts a source declaration from a pasted CSV. Whatever it
// drafts has to be a declaration the compiler accepts and the data satisfies.

import { describe, expect, it } from 'vitest';
import { draftSource } from '../playground/src/lib/infer.ts';
import { compile, run } from '../src/index.ts';

const CSV = 'visit_id,page,seconds,bounced,seen_on,referrer\n1,home,12.5,false,2026-11-01,search\n2,pricing,40,true,2026-11-02,\n3,home,7,false,2026-11-02,ad\n';

describe('drafted source declarations', () => {
  it('infers types, nullability and a key', () => {
    const { declaration } = draftSource('data/visits.csv', CSV);
    expect(declaration).toContain('source visits from "data/visits.csv" {');
    expect(declaration).toMatch(/visit_id:\s+int key,/);
    expect(declaration).toMatch(/page:\s+text,/);
    expect(declaration).toMatch(/seconds:\s+float,/);
    expect(declaration).toMatch(/bounced:\s+bool,/);
    expect(declaration).toMatch(/seen_on:\s+date,/);
    expect(declaration).toMatch(/referrer:\s+text\?,/);
  });

  it('compiles, and the file it was drafted from loads without a data error', () => {
    const { declaration } = draftSource('data/visits.csv', CSV);
    const result = compile(`${declaration}\npipeline by_page { from visits group by page { visits = count(), time = sum(seconds) } order by page }`);
    expect(result.diagnostics).toEqual([]);
    const rows = run(result.program!, { readSource: () => CSV }).get('by_page');
    expect(rows).toEqual([
      { page: 'home', visits: 2, time: 19.5 },
      { page: 'pricing', visits: 1, time: 40 },
    ]);
  });

  it('refuses a header the language cannot name, and says why', () => {
    expect(draftSource('data/x.csv', 'order id,total\n1,2\n').problem).toContain('"order id"');
    expect(draftSource('data/x.csv', 'from,total\n1,2\n').problem).toContain('"from"');
    expect(draftSource('data/x.csv', 'a,a\n1,2\n').problem).toBe('Two columns have the same name.');
    expect(draftSource('data/x.csv', '').declaration).toBeNull();
  });

  it('gives a source a usable name when the file name is not one', () => {
    expect(draftSource('data/2026-sales.csv', 'id\n1\n').declaration).toContain('source t_2026_sales from');
    expect(draftSource('data/order.csv', 'id\n1\n').declaration).toContain('source order_data from');
  });
});
