output "app_deployment" {
  value = {
    name    = "opentofu-only-app"
    version = "0.1.0"

    compute = {
      web = {
        kind      = "worker"
        readiness = "/healthz"
      }
    }

    routes = [
      {
        id     = "root"
        target = "web"
        path   = "/"
      },
    ]

    publish = [
      {
        name      = "launcher"
        publisher = "web"
        type      = "interface.ui.surface"
        outputs = {
          url = {
            kind     = "url"
            routeRef = "root"
          }
        }
        display = {
          title       = "OpenTofu Only"
          description = "Fixture app declared only through OpenTofu output and package metadata."
          category    = "test"
        }
        spec = {
          launcher = true
        }
      },
    ]

    env = {}
  }
}
