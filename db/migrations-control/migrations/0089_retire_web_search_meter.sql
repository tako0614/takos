-- takos-migration-safety: backfill

-- Web search is supplied by user/operator-registered MCP servers. Takos does
-- not own, meter, or price those upstream calls. The former Takos billing
-- tables were already removed by migration 0066, so there is deliberately no
-- table mutation here. Keeping a portable no-op makes both fresh installs and
-- upgrades safe on SQLite/D1 and PostgreSQL without recreating retired billing
-- ownership just to delete one legacy meter.
SELECT 1;
