// A small relational query double; tests exercise the actual route/service code.
type Row = Record<string, unknown>;
export function memoryDatabase(initial: Record<string, Row[]>) {
  const data = structuredClone(initial);
  const failures = new Set<string>();
  const writes: { table: string; operation: string; payload: unknown }[] = [];
  const from = (table: string) => {
    let operation = 'select'; let payload: Row | Row[] = {}; let count = false;
    const predicates: ((row: Row) => boolean)[] = [];
    let first = 0; let last = Infinity;
    const query = {
      select(_columns = '*', options?: { count?: string }) { count = Boolean(options?.count); return query; },
      insert(input: Row | Row[]) { operation = 'insert'; payload = input; return query; },
      update(input: Row) { operation = 'update'; payload = input; return query; },
      delete() { operation = 'delete'; return query; },
      eq(key: string, value: unknown) { predicates.push((row) => row[key] === value); return query; },
      neq(key: string, value: unknown) { predicates.push((row) => row[key] !== value); return query; },
      in(key: string, values: unknown[]) { predicates.push((row) => values.includes(row[key])); return query; },
      is(key: string, value: unknown) { predicates.push((row) => (row[key] ?? null) === value); return query; },
      order() { return query; }, limit(size: number) { last = size - 1; return query; },
      range(start: number, end: number) { first = start; last = end; return query; },
      single: async () => execute(true), maybeSingle: async () => execute(true),
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) { return Promise.resolve(execute(false)).then(resolve, reject); },
    };
    function execute(single: boolean) {
      if (failures.has(`${table}:${operation}`)) return { data: null, error: { message: 'injected failure' } };
      const rows = data[table] ?? (data[table] = []);
      let matched = rows.filter((row) => predicates.every((predicate) => predicate(row)));
      if (operation !== 'select') writes.push({ table, operation, payload: structuredClone(payload) });
      if (operation === 'insert') {
        matched = (Array.isArray(payload) ? payload : [payload]).map((row) => ({ id: crypto.randomUUID(), ...row }));
        rows.push(...matched);
      } else if (operation === 'update') matched.forEach((row) => Object.assign(row, payload));
      else if (operation === 'delete') data[table] = rows.filter((row) => !matched.includes(row));
      return { data: structuredClone(single ? matched[0] ?? null : matched.slice(first, last + 1)), error: null, ...(count ? { count: matched.length } : {}) };
    }
    return query;
  };
  return { data, from, writes, failures };
}
