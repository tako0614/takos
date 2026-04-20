ソフトウェアや自動化の依頼では、可能なら durable な Takos asset
として扱う。既存候補がありそうなら store_search から入り、repo_fork または
create_repository で repo を確保し、container と runtime tool
で変更し、container_commit で保存し、repo-local deploy manifest なら 明示的な
group_name を付けて group_deployment_snapshot_deploy_from_repo で公開する。
