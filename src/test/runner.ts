// Zero-dependency TAP-style test runner. Used for TDD across all modules.
// Suites register via describe(); tests via it(). run() executes them sequentially.

type TestFn = () => void | Promise<void>;
interface Test { name: string; fn: TestFn; }
interface Suite { name: string; tests: Test[]; befores: TestFn[]; }

const suites: Suite[] = [];
let current: Suite | null = null;

export function describe(name: string, fn: () => void): void {
  current = { name, tests: [], befores: [] };
  fn();
  suites.push(current);
  current = null;
}

export function it(name: string, fn: TestFn): void {
  if (!current) throw new Error("it() outside describe()");
  current.tests.push({ name, fn });
}

export function beforeEach(fn: TestFn): void {
  if (!current) throw new Error("beforeEach() outside describe()");
  current.befores.push(fn);
}

export function assertEqual<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error(
      `assertEqual failed${msg ? ": " + msg : ""}\n  expected: ${stringify(expected)}\n  actual:   ${stringify(actual)}`
    );
  }
}

export function assertDeepEqual(actual: unknown, expected: unknown, msg?: string): void {
  if (!deepEq(actual, expected)) {
    throw new Error(
      `assertDeepEqual failed${msg ? ": " + msg : ""}\n  expected: ${stringify(expected)}\n  actual:   ${stringify(actual)}`
    );
  }
}

export function assertTrue(v: unknown, msg?: string): void {
  if (!v) throw new Error(`assertTrue failed${msg ? ": " + msg : ""}`);
}

export function assertFalse(v: unknown, msg?: string): void {
  if (v) throw new Error(`assertFalse failed${msg ? ": " + msg : ""}`);
}

export function assertThrows(fn: () => unknown, msg?: string): void {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(`assertThrows expected throw${msg ? ": " + msg : ""}`);
}

export function assertNear(actual: number, expected: number, eps: number, msg?: string): void {
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`assertNear failed${msg ? ": " + msg : ""}\n  expected ~${expected}\n  actual ${actual}`);
  }
}

function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEq(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!deepEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

function stringify(v: unknown): string {
  try { return JSON.stringify(v); } catch { return String(v); }
}

export async function run(): Promise<void> {
  let pass = 0;
  let fail = 0;
  const failures: string[] = [];
  const t0 = Date.now();

  for (const suite of suites) {
    console.log(`# ${suite.name}`);
    for (const test of suite.tests) {
      const label = `${suite.name} > ${test.name}`;
      try {
        for (const b of suite.befores) await b();
        await test.fn();
        pass++;
        console.log(`ok - ${test.name}`);
      } catch (err) {
        fail++;
        const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
        failures.push(`${label}\n${msg}`);
        console.log(`not ok - ${test.name}`);
      }
    }
  }

  const dt = Date.now() - t0;
  console.log(`\n1..${pass + fail}`);
  console.log(`# pass ${pass}`);
  console.log(`# fail ${fail}`);
  console.log(`# time ${dt}ms`);

  if (fail > 0) {
    console.log(`\n--- failures ---`);
    for (const f of failures) console.log(f + "\n");
    const proc = (globalThis as unknown as { process?: { exit(code: number): never } }).process;
    if (proc) proc.exit(1);
    throw new Error("tests failed");
  }
}
