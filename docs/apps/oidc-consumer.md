# OIDC 連携

install したアプリは、operator の account plane がそのアプリ向けに OIDC client を
投影した場合に、Takosumi issuer を利用できます。これは install されたサービスへの
identity projection であり、汎用の third-party ログイン市場ではありません。

## 流れ

1. アプリを Git から Capsule として install し、Takosumi の plan を確認して apply する。
2. operator の policy が許す場合、account plane がその Capsule / アプリ向けの
   OIDC client projection を記録する。
3. Takos は Workspace 内で、投影されたサインイン情報を持つアプリとして表示する。
4. 失効とローテーションは account plane が扱い、audit evidence として記録される。

汎用の third-party consent / client registry の挙動は、その product surface が
明示的に作られるまでは対象外です。

## 次に読む

- [OIDC Setup](/operator/oidc-setup) — operator 側の設定
- [アカウントモデル](/operator/account-model) — 認証の所有権
