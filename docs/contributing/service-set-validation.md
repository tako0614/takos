# Service set validation

`deno task validate:service-set` checks the Helm chart without adding YAML
parser dependencies. It accepts only the Takos product service set in
`takos.io/service-id` labels:

- `takos-app`
- `takosumi`
- `takos-git`
- `takos-agent`

The validator also fails if the chart reintroduces old Takosumi process-role
workload labels/env values or old chart values keys such as `paasApi`.
