import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

type WorkerModule = {
  default?: {
    fetch?: (
      request: Request,
      env: Record<string, unknown>,
      ctx?: unknown,
    ) => unknown;
    scheduled?: (
      controller: unknown,
      env: Record<string, unknown>,
      ctx?: unknown,
    ) => unknown;
    queue?: (
      batch: unknown,
      env: Record<string, unknown>,
      ctx?: unknown,
    ) => unknown;
  };
  [name: string]: unknown;
};

type QueueProducerConfig = string | {
  queueName: string;
  deliveryDelay?: number;
};
type DurableObjectConfig = {
  className: string;
  scriptName?: string;
  useSQLite?: boolean;
};
type QueueMessage = {
  id: string;
  timestamp: Date;
  attempts: number;
  body?: unknown;
  serializedBody?: ArrayBuffer | ArrayBufferView;
};

type MiniflareWorkerOptions = {
  scriptPath?: string;
  rootPath?: string;
  modulesRoot?: string;
  bindings?: Record<string, string>;
  queueProducers?: Record<string, QueueProducerConfig>;
  durableObjects?: Record<string, DurableObjectConfig>;
  serviceBindings?: Record<
    string,
    string | ((request: Request) => Promise<Response>)
  >;
  d1Databases?: Record<string, string>;
  kvNamespaces?: Record<string, string>;
  r2Buckets?: Record<string, string>;
};

type QueueResult = {
  outcome: string;
  noRetry: boolean;
};

type DispatchQueueResult = {
  outcome: string;
  noRetry: boolean;
  ackAll: boolean;
  retryBatch: unknown[];
  explicitAcks: string[];
  retryMessages: unknown[];
};

type WorkflowState = {
  id: string;
  status:
    | "queued"
    | "running"
    | "paused"
    | "completed"
    | "errored"
    | "terminated";
  createdAt: string;
  params?: unknown;
};

function normalizeRequest(
  input: Request | string | URL,
  init?: RequestInit,
): Request {
  if (input instanceof Request) return input;
  if (typeof input === "string") {
    const isAbsoluteUrl = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(input);
    if (isAbsoluteUrl) return new Request(input, init);
    return new Request(new URL(input, "http://local.invalid"), init);
  }
  return new Request(new URL(input.toString(), "http://local.invalid"), init);
}

function asStringKey(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, "toString")
  ) {
    return String((value as { toString(): string }).toString());
  }
  return String(value);
}

function cloneTimestamp() {
  return new Date().toISOString();
}

function withQueueHelpers(messages: Array<QueueMessage>): {
  wrappedMessages: Array<QueueMessage & { ack(): void; retry(): void }>;
  explicitAcks: string[];
  retryMessages: Array<Record<string, unknown>>;
} {
  const explicitAcks: string[] = [];
  const retryMessages: Array<Record<string, unknown>> = [];

  const wrappedMessages = messages.map((message) => {
    const _msg = message as QueueMessage & {
      ack: () => void;
      retry: () => void;
    };
    return {
      ...message,
      ack: () => {
        explicitAcks.push(_msg.id);
      },
      retry: () => {
        retryMessages.push({
          id: _msg.id,
          deliveryAttempts: _msg.attempts,
        });
      },
    };
  });

  return { wrappedMessages, explicitAcks, retryMessages };
}

class InMemoryWorkflowStore {
  private readonly workflows = new Map<string, WorkflowState>();

  create(): WorkflowState {
    const id = crypto.randomUUID();
    const state: WorkflowState = {
      id,
      status: "queued",
      createdAt: cloneTimestamp(),
      params: undefined,
    };
    this.workflows.set(id, state);
    return state;
  }

  get(id: string): WorkflowState {
    const state = this.workflows.get(id);
    if (!state) throw new Error(`Workflow instance ${id} not found`);
    return state;
  }
}

function createWorkflowServiceHandler() {
  const store = new InMemoryWorkflowStore();
  return async (
    requestOrInput: Request | string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = requestOrInput instanceof Request
      ? requestOrInput
      : normalizeRequest(requestOrInput, init);
    const normalizedUrl = new URL(request.url, "http://rpc");
    const method = normalizedUrl.pathname.replace(/^\//, "");
    const body = request.method === "GET"
      ? {}
      : await request.json().catch(() => ({})) as Record<string, unknown>;

    switch (method) {
      case "create": {
        const state = store.create();
        const params = body.params;
        if (params !== undefined) {
          state.params = params;
        }
        return Response.json({ id: state.id });
      }
      case "status": {
        const id = typeof body.id === "string" ? body.id : "";
        const state = store.get(id);
        return Response.json({ status: state.status });
      }
      case "get": {
        const id = typeof body.id === "string" ? body.id : "";
        store.get(id);
        return Response.json({});
      }
      case "pause":
      case "resume":
      case "terminate":
      case "restart": {
        const id = typeof body.id === "string" ? body.id : "";
        store.get(id);
        return Response.json({ ok: true });
      }
      default:
        return Response.json({ error: `Unknown Workflow method: ${method}` }, {
          status: 404,
        });
    }
  };
}

function createSimpleServiceBinding(
  fetcher: string | ((request: Request) => Promise<Response>) | undefined,
) {
  if (typeof fetcher === "function") {
    return {
      fetch: (input: Request | string | URL, init?: RequestInit) =>
        fetcher(normalizeRequest(input, init)),
    };
  }
  return {
    fetch: (input: Request | string | URL, init?: RequestInit) =>
      globalThis.fetch(normalizeRequest(input, init)),
  };
}

function createQueueProducer() {
  return {
    send: (message: unknown) =>
      Promise.resolve({ id: crypto.randomUUID(), message }),
  };
}

class DurableObjectState {
  readonly storage = new Map<string, unknown>();
}

class DurableObjectNamespace {
  private readonly stateById = new Map<string, DurableObjectState>();
  private readonly instances = new Map<
    string,
    {
      fetch: (
        request: Request,
        env: Record<string, unknown>,
        ctx: Record<string, unknown>,
      ) => unknown;
    }
  >();

  constructor(
    private readonly clazz: {
      new (state: DurableObjectState, env: Record<string, unknown>): unknown;
    },
    private readonly env: Record<string, unknown>,
  ) {
  }

  idFromName(name: string) {
    return {
      toString: () => name,
      name,
    };
  }

  idFromString(id: string) {
    return {
      toString: () => id,
      name: id,
    };
  }

  newUniqueId() {
    return {
      toString: () => crypto.randomUUID(),
    };
  }

  private getInstance(
    id: string,
  ): {
    fetch: (
      request: Request,
      env: Record<string, unknown>,
      ctx: Record<string, unknown>,
    ) => unknown;
  } {
    const entry = this.instances.get(id);
    if (entry) return entry;
    const state = this.stateById.get(id) ?? new DurableObjectState();
    this.stateById.set(id, state);
    const raw = new this.clazz(state, this.env);
    const instanceFetch =
      typeof (raw as { fetch?: unknown }).fetch === "function"
        ? (raw as {
          fetch: (
            request: Request,
            env: Record<string, unknown>,
            ctx: Record<string, unknown>,
          ) => unknown;
        }).fetch
        : null;
    if (!instanceFetch) {
      throw new Error("Durable object class does not implement fetch(request)");
    }
    const obj = {
      fetch: (
        request: Request,
        env: Record<string, unknown>,
        ctx: Record<string, unknown>,
      ) => Promise.resolve(instanceFetch.call(raw, request, env, ctx)),
    };
    this.instances.set(id, obj);
    return obj;
  }

  get(id: string | { toString(): string }) {
    const resolvedId = asStringKey(id);
    return {
      id: resolvedId,
      fetch: (input: string | URL | Request, init?: RequestInit) => {
        const request = normalizeRequest(input, init);
        const stub = this.getInstance(resolvedId);
        return Promise.resolve(stub.fetch(request, this.env, {}));
      },
    };
  }
}

function createMockResourceStore() {
  const store = new Map<string, unknown>();
  return {
    get: (key: string) =>
      Promise.resolve(store.has(key) ? store.get(key) : null),
    put: (key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve({});
    },
    delete: (key: string) => {
      store.delete(key);
      return Promise.resolve({});
    },
    list: () => Promise.resolve({ keys: [...store.keys()] }),
  };
}

function createMockD1() {
  return {};
}

export class MockMiniflare {
  ready: Promise<void>;
  private readonly options: MiniflareWorkerOptions;
  private workerModule: WorkerModule | null = null;
  private delegateModule: WorkerModule | null = null;
  private env: Record<string, unknown> = {};
  private readonly workflowService = createWorkflowServiceHandler();

  constructor(options: MiniflareWorkerOptions) {
    this.options = options;
    this.ready = this.initialize();
  }

  dispose(): Promise<void> {
    // Nothing to dispose for in-memory runtime.
    return Promise.resolve();
  }

  private async initialize(): Promise<void> {
    if (!this.options.scriptPath) {
      throw new Error("Miniflare scriptPath is required in mock");
    }

    const rootPath = this.options.rootPath
      ? path.resolve(this.options.rootPath)
      : (this.options.modulesRoot
        ? path.resolve(this.options.modulesRoot)
        : process.cwd());
    const scriptPath = path.isAbsolute(this.options.scriptPath)
      ? path.resolve(this.options.scriptPath)
      : path.join(rootPath, this.options.scriptPath);
    this.workerModule = await import(pathToFileURL(scriptPath).href);
    const scriptDir = path.dirname(scriptPath);
    const isWrappedEntry = path.basename(scriptPath) === "__takos_entry.mjs";
    if (isWrappedEntry) {
      const baseScriptPath = path.join(scriptDir, "bundle.mjs");
      this.delegateModule = await import(pathToFileURL(baseScriptPath).href);
    } else {
      this.delegateModule = this.workerModule;
    }

    if (!this.delegateModule) {
      throw new Error("No delegate module found for Miniflare mock");
    }

    const plainBindings = this.options.bindings ?? {};
    const queueProducers = this.options.queueProducers ?? {};
    const durableObjects = this.options.durableObjects ?? {};
    const serviceBindings = this.options.serviceBindings ?? {};

    Object.assign(this.env, {
      ...plainBindings,
      ...Object.fromEntries(
        Object.keys(this.options.d1Databases ?? {}).map((
          name,
        ) => [name, createMockD1()]),
      ),
      ...Object.fromEntries(
        Object.keys(this.options.kvNamespaces ?? {}).map((
          name,
        ) => [name, createMockResourceStore()]),
      ),
      ...Object.fromEntries(
        Object.keys(this.options.r2Buckets ?? {}).map((
          name,
        ) => [name, createMockResourceStore()]),
      ),
    });

    for (const [name, producer] of Object.entries(queueProducers)) {
      if (
        typeof producer === "string" || producer?.constructor?.name === "String"
      ) {
        this.env[name] = createQueueProducer();
      } else if (typeof producer === "object") {
        this.env[name] = createQueueProducer();
      } else {
        this.env[name] = createQueueProducer();
      }
    }

    for (const [name, durable] of Object.entries(durableObjects)) {
      const ctor = this.delegateModule[durable.className];
      if (typeof ctor !== "function") {
        throw new Error(`Durable object class not found: ${durable.className}`);
      }
      this.env[name] = new DurableObjectNamespace(
        ctor as {
          new (
            state: DurableObjectState,
            env: Record<string, unknown>,
          ): unknown;
        },
        this.env,
      );
    }

    for (const [name, binding] of Object.entries(serviceBindings)) {
      const isMockWorkflowBinding = name.startsWith("__TAKOS_WORKFLOW_");
      if (isMockWorkflowBinding) {
        this.env[name] = { fetch: this.workflowService };
      } else {
        this.env[name] = createSimpleServiceBinding(binding as never);
      }
    }
  }

  private createContext(): { waitUntil: (promise: Promise<unknown>) => void } {
    return {
      waitUntil: (promise) => {
        promise.catch(() => undefined);
      },
    };
  }

  async getWorker(): Promise<{
    fetch: (
      input: Request | string | URL,
      init?: RequestInit,
    ) => Promise<Response>;
    scheduled: (
      controller: { scheduledTime?: string | number | Date; cron: string },
    ) => Promise<QueueResult>;
    queue: (
      queueName: string,
      messages: Array<
        { id: string; timestamp: Date; attempts: number; body?: unknown }
      >,
    ) => Promise<DispatchQueueResult>;
    connect(): never;
  }> {
    await this.ready;
    const workerModule = this.workerModule;
    if (!workerModule || !workerModule.default) {
      throw new Error("No worker module loaded");
    }
    const workerBinding = workerModule.default as NonNullable<
      WorkerModule["default"]
    >;
    return {
      fetch: async (
        input: Request | string | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        if (typeof workerBinding.fetch !== "function") {
          throw new Error("Worker entrypoint has no fetch handler");
        }
        const request = normalizeRequest(input, init);
        const response = await Promise.resolve(
          workerBinding.fetch(request, this.env, this.createContext()),
        );
        if (response instanceof Response) return response;
        return new Response(response as never);
      },
      scheduled: async (
        controller: { scheduledTime?: string | number | Date; cron: string },
      ) => {
        if (typeof workerBinding.scheduled !== "function") {
          return { outcome: "missing", noRetry: false };
        }
        const scheduledTime = controller.scheduledTime instanceof Date
          ? controller.scheduledTime.getTime()
          : typeof controller.scheduledTime === "number"
          ? controller.scheduledTime
          : controller.scheduledTime
          ? Date.parse(new Date(controller.scheduledTime).toISOString())
          : Date.now();
        await Promise.resolve(
          workerBinding.scheduled(
            { ...controller, scheduledTime },
            this.env,
            this.createContext(),
          ),
        );
        return { outcome: "ok", noRetry: false };
      },
      queue: async (
        queueName: string,
        messages: Array<
          {
            id: string;
            timestamp: Date;
            attempts: number;
            body?: unknown;
            serializedBody?: ArrayBuffer | ArrayBufferView;
          }
        >,
      ) => {
        if (typeof workerBinding.queue !== "function") {
          return {
            outcome: "missing",
            noRetry: false,
            ackAll: true,
            retryBatch: [],
            explicitAcks: [],
            retryMessages: [],
          };
        }
        const normalized = messages.map((message, index) => ({
          ...message,
          timestamp: message.timestamp ?? new Date(),
          attempts: message.attempts ?? 0,
          queue: queueName,
          index,
        }));
        const { wrappedMessages, explicitAcks, retryMessages } =
          withQueueHelpers(normalized as Array<QueueMessage>);
        await Promise.resolve(workerBinding.queue(
          {
            queue: queueName,
            messages: wrappedMessages,
          },
          this.env,
          this.createContext(),
        ));
        return {
          outcome: "ok",
          noRetry: false,
          ackAll: explicitAcks.length === normalized.length,
          retryBatch: [],
          explicitAcks,
          retryMessages,
        };
      },
      connect(): never {
        throw new Error("connect() is not supported in the mock Miniflare");
      },
    };
  }
}
