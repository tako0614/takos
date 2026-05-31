// Bun migration shim: @std/testing/time -> FakeTime implementation.
// Minimal port of @std/testing/time's FakeTime covering the subset used in the
// tree: install/restore, .tick()/.tickAsync(), .now, and faking of Date.now,
// setTimeout/clearTimeout, setInterval/clearInterval. Wired via tsconfig paths.

interface Timer {
  id: number;
  due: number;
  interval: number | null;
  cb: (...args: unknown[]) => void;
  args: unknown[];
}

export class FakeTime {
  static #current: FakeTime | null = null;

  #now: number;
  #timers = new Map<number, Timer>();
  #nextId = 1;

  #realNow: typeof Date.now;
  #realSetTimeout: typeof setTimeout;
  #realClearTimeout: typeof clearTimeout;
  #realSetInterval: typeof setInterval;
  #realClearInterval: typeof clearInterval;
  #realDate: DateConstructor;

  constructor(start?: number | string | Date) {
    if (FakeTime.#current) {
      throw new Error("FakeTime is already installed");
    }
    this.#now = start === undefined
      ? Date.now()
      : start instanceof Date
      ? start.getTime()
      : typeof start === "string"
      ? new Date(start).getTime()
      : start;

    this.#realNow = Date.now;
    this.#realSetTimeout = globalThis.setTimeout;
    this.#realClearTimeout = globalThis.clearTimeout;
    this.#realSetInterval = globalThis.setInterval;
    this.#realClearInterval = globalThis.clearInterval;
    this.#realDate = globalThis.Date;

    const now = () => this.#now;

    Date.now = () => now();

    // Replace Date so `new Date()` (no args) uses fake clock.
    const RealDate = this.#realDate;
    const FakeDate = function (this: unknown, ...args: unknown[]) {
      if (args.length === 0) {
        return new RealDate(now());
      }
      // @ts-ignore variadic forward
      return new RealDate(...args);
    } as unknown as DateConstructor;
    FakeDate.now = () => now();
    FakeDate.parse = RealDate.parse;
    FakeDate.UTC = RealDate.UTC;
    (FakeDate as unknown as { prototype: unknown }).prototype =
      RealDate.prototype;
    globalThis.Date = FakeDate;

    globalThis.setTimeout =
      ((cb: (...a: unknown[]) => void, delay = 0, ...args: unknown[]) => {
        const id = this.#nextId++;
        this.#timers.set(id, {
          id,
          due: this.#now + delay,
          interval: null,
          cb,
          args,
        });
        return id as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout;

    globalThis.clearTimeout = ((id?: ReturnType<typeof setTimeout>) => {
      if (id !== undefined) this.#timers.delete(id as unknown as number);
    }) as typeof clearTimeout;

    globalThis.setInterval =
      ((cb: (...a: unknown[]) => void, delay = 0, ...args: unknown[]) => {
        const id = this.#nextId++;
        this.#timers.set(id, {
          id,
          due: this.#now + delay,
          interval: delay,
          cb,
          args,
        });
        return id as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval;

    globalThis.clearInterval = ((id?: ReturnType<typeof setInterval>) => {
      if (id !== undefined) this.#timers.delete(id as unknown as number);
    }) as typeof clearInterval;

    FakeTime.#current = this;
  }

  get now(): number {
    return this.#now;
  }

  set now(value: number) {
    this.tick(value - this.#now);
  }

  #runDue(target: number): void {
    while (true) {
      let next: Timer | undefined;
      for (const t of this.#timers.values()) {
        if (
          t.due <= target &&
          (!next || t.due < next.due || (t.due === next.due && t.id < next.id))
        ) {
          next = t;
        }
      }
      if (!next) break;
      this.#now = next.due;
      if (next.interval !== null) {
        next.due = this.#now + next.interval;
      } else {
        this.#timers.delete(next.id);
      }
      next.cb(...next.args);
    }
    this.#now = target;
  }

  tick(ms = 0): void {
    this.#runDue(this.#now + ms);
  }

  async tickAsync(ms = 0): Promise<void> {
    const target = this.#now + ms;
    this.#runDue(target);
    await Promise.resolve();
  }

  next(): boolean {
    let next: Timer | undefined;
    for (const t of this.#timers.values()) {
      if (!next || t.due < next.due) next = t;
    }
    if (!next) return false;
    this.#runDue(next.due);
    return true;
  }

  restore(): void {
    if (FakeTime.#current !== this) return;
    Date.now = this.#realNow;
    globalThis.Date = this.#realDate;
    globalThis.setTimeout = this.#realSetTimeout;
    globalThis.clearTimeout = this.#realClearTimeout;
    globalThis.setInterval = this.#realSetInterval;
    globalThis.clearInterval = this.#realClearInterval;
    this.#timers.clear();
    FakeTime.#current = null;
  }

  static restore(): void {
    FakeTime.#current?.restore();
  }
}
