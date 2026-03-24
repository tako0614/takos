INSERT INTO oauth_clients (
  id, client_id, client_secret_hash, client_type, name, description,
  logo_uri, client_uri, policy_uri, tos_uri,
  redirect_uris, grant_types, response_types, allowed_scopes,
  owner_id, registration_access_token_hash, status, created_at, updated_at
) VALUES (
  '514666e7c2d802fb0419b9e9',
  'lgpPbKjugXXbML8ACIbfpw',
  'd6b9611acba8396925ee230d9ced360879d078a63ede66d75fdc6ab8671eafc6',
  'confidential',
  'Yurucommu (tako2)',
  NULL,
  NULL, NULL, NULL, NULL,
  '["https://tako2.app.takos.jp/api/auth/callback/takos"]',
  '["authorization_code", "refresh_token"]',
  '["code"]',
  '["openid", "profile", "email", "spaces:read", "repos:read"]',
  NULL,
  '7e2d14f0f8bb7540fc1fae9c4a3237be2f6d97b4703d84348ba301ea85830161',
  'active',
  datetime('now'),
  datetime('now')
);
