const D1_BINDING_IO = new Set(['batch', 'exec', 'dump']);
const D1_STATEMENT_IO = new Set(['all', 'first', 'run', 'raw']);

function counters() {
  const value = { started: 0, active: 0, settled: 0, rejected: 0, synchronousThrows: 0 };
  return {
    value,
    snapshot: () => ({ ...value }),
  };
}

function observePromise(work, counts) {
  if ((typeof work !== 'object' && typeof work !== 'function') || work === null) {
    counts.value.synchronousThrows++;
    throw new TypeError('native asynchronous operation did not return a Promise');
  }
  let then;
  try {
    then = work.then;
  } catch (error) {
    counts.value.synchronousThrows++;
    throw error;
  }
  if (typeof then !== 'function') {
    counts.value.synchronousThrows++;
    throw new TypeError('native asynchronous operation returned a non-Promise');
  }
  const value = counts.value;
  value.started++;
  value.active++;
  try {
    // Observe without returning this derived promise: callers keep the native promise identity.
    then.call(work, () => {
      value.active--;
      value.settled++;
    }, () => {
      value.active--;
      value.settled++;
      value.rejected++;
    });
  } catch (error) {
    value.active--;
    value.started--;
    value.synchronousThrows++;
    throw error;
  }
  return work;
}

function invokeIO(target, method, args, counts) {
  let result;
  try {
    result = Reflect.apply(method, target, args);
  } catch (error) {
    counts.value.synchronousThrows++;
    throw error;
  }
  return observePromise(result, counts);
}

function callableProperty(target, property) {
  return Reflect.get(target, property, target);
}

/** Instrument the native D1 binding without changing its receiver or returned promises. */
export function trackNativeD1Work(binding) {
  if ((typeof binding !== 'object' && typeof binding !== 'function') || binding === null) {
    throw new TypeError('D1 binding must be an object');
  }
  const counts = counters();
  const statementProxyToNative = new WeakMap();
  const statementNativeToProxy = new WeakMap();
  const bindingMethodCache = new Map();

  const ownStatement = (statement) => {
    if ((typeof statement !== 'object' && typeof statement !== 'function') || statement === null) {
      throw new TypeError('native D1 prepare/bind did not return a statement');
    }
    const existing = statementNativeToProxy.get(statement);
    if (existing) return existing;
    const methods = new Map();
    const proxy = new Proxy(statement, {
      get(target, property) {
        const value = callableProperty(target, property);
        if (typeof value !== 'function') return value;
        if (!D1_STATEMENT_IO.has(property) && property !== 'bind') {
          throw new TypeError(`unsupported callable native D1 statement API: ${String(property)}`);
        }
        let wrapped = methods.get(property);
        if (wrapped) return wrapped;
        wrapped = (...args) => {
          if (property === 'bind') {
            let result;
            try {
              result = Reflect.apply(value, target, args);
            } catch (error) {
              counts.value.synchronousThrows++;
              throw error;
            }
            if ((typeof result !== 'object' && typeof result !== 'function') || result === null) {
              throw new TypeError('native D1 bind did not return a statement');
            }
            return ownStatement(result);
          }
          return invokeIO(target, value, args, counts);
        };
        methods.set(property, wrapped);
        return wrapped;
      },
      set(target, property, value) { return Reflect.set(target, property, value, target); },
      has(target, property) { return Reflect.has(target, property); },
      ownKeys(target) { return Reflect.ownKeys(target); },
      getOwnPropertyDescriptor(target, property) { return Reflect.getOwnPropertyDescriptor(target, property); },
      getPrototypeOf(target) { return Reflect.getPrototypeOf(target); },
    });
    statementProxyToNative.set(proxy, statement);
    statementNativeToProxy.set(statement, proxy);
    return proxy;
  };

  const wrappedBinding = new Proxy(binding, {
    get(target, property) {
      const value = callableProperty(target, property);
      if (typeof value !== 'function') return value;
      if (property !== 'prepare' && !D1_BINDING_IO.has(property)) {
        throw new TypeError(`unsupported callable native D1 binding API: ${String(property)}`);
      }
      let wrapped = bindingMethodCache.get(property);
      if (wrapped) return wrapped;
      wrapped = (...args) => {
        if (property === 'prepare') {
          let statement;
          try {
            statement = Reflect.apply(value, target, args);
          } catch (error) {
            counts.value.synchronousThrows++;
            throw error;
          }
          return ownStatement(statement);
        }
        if (property === 'batch') {
          if (!Array.isArray(args[0])) throw new TypeError('native D1 batch requires an array of owned statements');
          const nativeStatements = args[0].map((statement) => {
            const native = statementProxyToNative.get(statement);
            if (!native) throw new TypeError('native D1 batch refused a foreign statement');
            return native;
          });
          return invokeIO(target, value, [nativeStatements, ...args.slice(1)], counts);
        }
        return invokeIO(target, value, args, counts);
      };
      bindingMethodCache.set(property, wrapped);
      return wrapped;
    },
    set(target, property, value) { return Reflect.set(target, property, value, target); },
    has(target, property) { return Reflect.has(target, property); },
    ownKeys(target) { return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, property) { return Reflect.getOwnPropertyDescriptor(target, property); },
    getPrototypeOf(target) { return Reflect.getPrototypeOf(target); },
  });
  return { binding: wrappedBinding, snapshot: counts.snapshot };
}

/**
 * Observe waitUntil work without replacing its Promise or native return value. `active` counts
 * observed unfinished work, including a Promise still pending after waitUntil synchronously throws;
 * it does not mean the native runtime accepted or retained that registration.
 */
export function trackNativeStateWaitUntil(state) {
  if ((typeof state !== 'object' && typeof state !== 'function') || state === null) {
    throw new TypeError('Durable Object state must be an object');
  }
  const counts = counters();
  let wrappedWaitUntil;
  const methodCache = new Map();
  const wrappedState = new Proxy(state, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (property !== 'waitUntil') {
        let wrapped = methodCache.get(property);
        if (!wrapped) {
          wrapped = (...args) => Reflect.apply(value, target, args);
          methodCache.set(property, wrapped);
        }
        return wrapped;
      }
      if (wrappedWaitUntil) return wrappedWaitUntil;
      wrappedWaitUntil = (work) => {
        if ((typeof work !== 'object' && typeof work !== 'function') || work === null) {
          counts.value.synchronousThrows++;
          throw new TypeError('state.waitUntil requires the original work Promise');
        }
        let then;
        try { then = work.then; } catch (error) { counts.value.synchronousThrows++; throw error; }
        if (typeof then !== 'function') {
          counts.value.synchronousThrows++;
          throw new TypeError('state.waitUntil requires the original work Promise');
        }
        counts.value.started++;
        counts.value.active++;
        try {
          then.call(work, () => {
            counts.value.active--;
            counts.value.settled++;
          }, () => {
            counts.value.active--;
            counts.value.settled++;
            counts.value.rejected++;
          });
        } catch (error) {
          counts.value.active--;
          counts.value.started--;
          counts.value.synchronousThrows++;
          throw error;
        }
        try {
          return Reflect.apply(value, target, [work]);
        } catch (error) {
          counts.value.synchronousThrows++;
          throw error;
        }
      };
      return wrappedWaitUntil;
    },
    set(target, property, value) { return Reflect.set(target, property, value, target); },
    has(target, property) { return Reflect.has(target, property); },
    ownKeys(target) { return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, property) { return Reflect.getOwnPropertyDescriptor(target, property); },
    getPrototypeOf(target) { return Reflect.getPrototypeOf(target); },
  });
  return { state: wrappedState, snapshot: counts.snapshot };
}
