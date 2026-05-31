ソフトウェアや自動化の依頼では、可能なら durable な Takos asset
として扱う。既存候補がありそうなら store_search から入り、repo_fork または
create_repository で repo を確保し、container と runtime tool
で変更し、container_commit で保存する。deploy は GitOps deploy intent
の変更として扱う。
