export function SecurityDisclosureContent() {
  return (
    <article class="prose prose-zinc prose-sm max-w-none">
      <h1>脆弱性報告ポリシー</h1>
      <p class="text-zinc-500">最終更新日: 2026年5月7日</p>

      <p>
        Takos のセキュリティ上の問題を発見した場合は、公開 issue
        や掲示板に詳細を書かず、
        <a href="mailto:security@takos.jp">security@takos.jp</a>
        までご連絡ください。Takos
        は、誠実な調査・報告に対して協調的に対応します。
      </p>

      <h2>報告に含めてほしい情報</h2>
      <ul>
        <li>影響を受ける URL、API、機能、または repository</li>
        <li>影響の概要と、影響を受ける可能性があるデータ種別</li>
        <li>再現手順と、最小限の証跡</li>
        <li>検証に使用したアカウントやテナント識別子</li>
        <li>既に確認した回避策や修正案</li>
      </ul>

      <p>
        本番の秘密情報、秘密鍵、raw access
        token、第三者の個人データは送信しないでください。機微な証跡が必要な場合は、まず最小限の概要だけを送ってください。
      </p>

      <h2>対象範囲</h2>
      <p>
        Takos Web/API、Git service profile、agent runtime profile、Takos の
        managed deployment artifacts、および Takos managed service
        として提供される featured apps を対象とします。
      </p>

      <h2>対象外</h2>
      <ul>
        <li>
          Takos の認証・分離・課金・管理基盤に影響しないユーザー所有アプリ
        </li>
        <li>ソーシャルエンジニアリング、フィッシング、物理攻撃</li>
        <li>サービス妨害、負荷試験、スパム、永続化、横展開</li>
        <li>影響確認に必要な範囲を超えるデータ取得や改ざん</li>
      </ul>

      <h2>対応目安</h2>
      <table>
        <thead>
          <tr>
            <th class="text-left">重大度</th>
            <th class="text-left">受領確認</th>
            <th class="text-left">初期 triage</th>
            <th class="text-left">修正目標</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Critical</td>
            <td>3 営業日以内</td>
            <td>7 日以内</td>
            <td>15 日以内</td>
          </tr>
          <tr>
            <td>High</td>
            <td>3 営業日以内</td>
            <td>7 日以内</td>
            <td>30 日以内</td>
          </tr>
          <tr>
            <td>Medium</td>
            <td>5 営業日以内</td>
            <td>14 日以内</td>
            <td>60 日以内</td>
          </tr>
          <tr>
            <td>Low</td>
            <td>5 営業日以内</td>
            <td>21 日以内</td>
            <td>90 日以内または次回計画 release</td>
          </tr>
        </tbody>
      </table>

      <h2>公開時期</h2>
      <p>
        原則として、報告の検証後 90
        日間は協調的な公開猶予をお願いします。修正が広く適用済み、または既に悪用が確認されている場合は、報告者と調整してより早い公開を検討します。
      </p>

      <h2>PGP 暗号化</h2>
      <p>
        高機微な報告のための PGP 公開鍵は GA 前に docs.takos.jp
        で公開します。公開鍵が掲載されるまで、秘密情報や第三者データを含む証跡は送らないでください。
      </p>
    </article>
  );
}
