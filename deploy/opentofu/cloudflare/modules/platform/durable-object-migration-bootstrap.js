class MigrationBootstrapDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch() {
    return new Response("Takos Durable Object migration bootstrap", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

export class SessionDO extends MigrationBootstrapDurableObject {}
export class RunNotifierDO extends MigrationBootstrapDurableObject {}
export class NotificationNotifierDO extends MigrationBootstrapDurableObject {}
export class RateLimiterDO extends MigrationBootstrapDurableObject {}
export class RoutingDO extends MigrationBootstrapDurableObject {}
export class ExecutorContainerTier1 extends MigrationBootstrapDurableObject {}
export class ExecutorContainerTier2 extends MigrationBootstrapDurableObject {}
export class ExecutorContainerTier3 extends MigrationBootstrapDurableObject {}

export default {
  async fetch() {
    return new Response("Takos is preparing Durable Object namespaces", {
      status: 503,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "retry-after": "5",
      },
    });
  },
};
