# Release Announcement Template

> このページでわかること: release announcement に必須の changelog、
> breaking change、migration guide、rollback plan、validation evidence。

Use this template for customer-impacting Takos releases and internal production
promotions.

```md
# Takos Release <version or date>

## Summary

- Release candidate commit:
- Production deployment id:
- Release owner:
- Operator:
- Release window:

## What Changed

- User-facing changes:
- API / contract changes:
- Operational changes:
- Security / privacy / legal changes:

## Breaking Changes

- Breaking change present: yes / no
- Affected users or integrations:
- Compatibility window:
- Deprecation or removal date:

## Migration Guide

- Required user action:
- Required operator action:
- Data migration:
- Downgrade limitation:

## Validation Evidence

- Release gate:
- Staging deploy:
- Smoke tests:
- Docs build:
- Terraform / Helm evidence:
- Migration safety evidence:

## Rollback Plan

- Previous healthy deployment id:
- Rollback command or runbook:
- Artifact retention confirmed:
- Expected recovery signal:

## Communication

- Customer announcement:
- Status page:
- Support note:
- Known limitations:
```

Block release if any of these sections is missing for a production-impacting
change:

- changelog / what changed
- breaking change assessment
- migration guide or explicit "no migration required"
- rollback plan with previous healthy deployment id
- validation evidence linked to the release candidate commit

Security emergency releases may publish a shortened announcement first, but the
full template must be completed during incident closure.
