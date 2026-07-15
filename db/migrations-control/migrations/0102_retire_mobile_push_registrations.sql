-- takos-migration-safety: contract
-- takos-migration-approval: Takos mobile now registers provider tokens only as product-neutral HTTP pushers through notification_pushers; the legacy direct-token route has no remaining reader or writer.
-- takos-migration-rollback: restore from backup only when rolling back to a pre-pusher Takos build; otherwise re-register devices through the notification pusher endpoint because legacy rows do not contain a safe gateway URL.

DROP TABLE IF EXISTS "mobile_push_registrations";
