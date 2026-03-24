class ContainerTcpPortShim {
  async fetch(url, request) {
    return Response.json({
      error: 'Cloudflare Containers are unavailable in local mode',
      url,
      method: request?.method ?? 'GET',
    }, { status: 503 });
  }
}

export class Container {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.envVars = {};
    this.container = {
      getTcpPort() {
        return new ContainerTcpPortShim();
      },
    };
  }

  async startAndWaitForPorts() {}

  renewActivityTimeout() {}

  async destroy() {}
}
