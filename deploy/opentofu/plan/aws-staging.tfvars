# CI-only plan fixture. Do not use for apply.
target              = "aws"
environment         = "staging"
db_password         = "ci-plan-placeholder-not-a-secret"
opentofu_plan_mode = true

aws = {
  region               = "ap-northeast-1"
  vpc_cidr             = "10.10.0.0/16"
  db_instance_class    = "db.t4g.micro"
  db_allocated_storage = 20
  redis_node_type      = "cache.t4g.micro"
  s3_bucket_prefix     = "takos-staging"
  dynamo_kv_table_name = "takos-staging-kv"
}
