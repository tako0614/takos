/**
 * バリデーションユーティリティ
 *
 * すべての takos パッケージで使える
 * 入力サニタイズとセキュリティ向けの共通関数を提供する。
 */

import { isPrivateIP as classifyPrivateIP } from "../../contracts/public/ip-classification.ts";

/**
 * ホスト名が localhost / ローカルアドレスか判定する。
 *
 * @param hostname - 判定対象のホスト名
 * @returns ローカル系ホスト名なら true
 */
export function isLocalhost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === "localhost" ||
    lower === "127.0.0.1" ||
    lower === "::1" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".localdomain") ||
    lower.endsWith(".internal")
  );
}

/**
 * IP アドレスがプライベート/内部アドレスか判定する。
 *
 * 判定ロジックは takos 全体で共有する canonical な分類器
 * (`src/contracts/public/ip-classification.ts`) に委譲する。以前はこの関数と
 * takos-git の host-blocklist がそれぞれ手書きでレンジ判定を持っていて、片方
 * だけ強化されると drift する SSRF リスクがあったため、union（より強い分類）を
 * 1 箇所に集約している。
 *
 * @param ip - 判定対象の IP アドレス
 * @returns プライベート IP なら true
 */
export function isPrivateIP(ip: string): boolean {
  return classifyPrivateIP(ip);
}
