import type { Lang } from '../types';
import { Bilingual } from '../components/Bilingual';
import { CodeBlock, H3, P } from '../components/primitives';

function QuickstartSection({ lang }: { lang: Lang }) {
  return (
    <Bilingual
      lang={lang}
      ja={
        <div>
          <H3>1. アカウント作成</H3>
          <P>takos.jp にアクセスし、Google アカウントでログインします。</P>

          <H3>2. CLI インストール</H3>
          <CodeBlock>{`npm install -g @takos/cli`}</CodeBlock>

          <H3>3. ログイン</H3>
          <CodeBlock>{`takos login`}</CodeBlock>

          <H3>4. Space の作成</H3>
          <P>Web UI または CLI で Space を作成します。</P>
          <CodeBlock>{`takos api post /api/spaces --body '{"name": "my-space"}'`}</CodeBlock>

          <H3>5. リポジトリの作成と clone</H3>
          <CodeBlock>{`# リポジトリ作成
takos api post /api/spaces/:spaceId/repos \\
  --body '{"name": "my-app", "visibility": "private"}'

# clone
git clone https://takos.jp/git/:repoId my-app
cd my-app`}</CodeBlock>

          <H3>6. マニフェスト作成</H3>
          <CodeBlock>{`# .takos/app.yml
apiVersion: takos.dev/v1alpha1
kind: Package
metadata:
  name: my-app
spec:
  version: "1.0.0"
---
kind: Workload
metadata:
  name: api
spec:
  type: cloudflare.worker
---
kind: Endpoint
metadata:
  name: main
spec:
  protocol: http
  targetRef: api`}</CodeBlock>

          <H3>7. Push &amp; Deploy</H3>
          <CodeBlock>{`git add .
git commit -m "initial commit"
git push origin main

takos deploy --space SPACE_ID --repo REPO_ID --ref main`}</CodeBlock>
          <P>デプロイが完了すると *.app.takos.jp でアクセスできます。</P>
        </div>
      }
      en={
        <div>
          <H3>1. Create an Account</H3>
          <P>Visit takos.jp and sign in with your Google account.</P>

          <H3>2. Install the CLI</H3>
          <CodeBlock>{`npm install -g @takos/cli`}</CodeBlock>

          <H3>3. Log In</H3>
          <CodeBlock>{`takos login`}</CodeBlock>

          <H3>4. Create a Space</H3>
          <P>Create a Space via the Web UI or CLI.</P>
          <CodeBlock>{`takos api post /api/spaces --body '{"name": "my-space"}'`}</CodeBlock>

          <H3>5. Create and Clone a Repository</H3>
          <CodeBlock>{`# Create repository
takos api post /api/spaces/:spaceId/repos \\
  --body '{"name": "my-app", "visibility": "private"}'

# Clone
git clone https://takos.jp/git/:repoId my-app
cd my-app`}</CodeBlock>

          <H3>6. Create Manifest</H3>
          <CodeBlock>{`# .takos/app.yml
apiVersion: takos.dev/v1alpha1
kind: Package
metadata:
  name: my-app
spec:
  version: "1.0.0"
---
kind: Workload
metadata:
  name: api
spec:
  type: cloudflare.worker
---
kind: Endpoint
metadata:
  name: main
spec:
  protocol: http
  targetRef: api`}</CodeBlock>

          <H3>7. Push &amp; Deploy</H3>
          <CodeBlock>{`git add .
git commit -m "initial commit"
git push origin main

takos deploy --space SPACE_ID --repo REPO_ID --ref main`}</CodeBlock>
          <P>Once deployed, your app is accessible at *.app.takos.jp.</P>
        </div>
      }
    />
  );
}

export default QuickstartSection;
