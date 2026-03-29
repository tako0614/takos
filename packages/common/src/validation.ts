/**
 * バリデーションユーティリティ
 *
 * すべての takos パッケージで使える
 * 入力サニタイズとセキュリティ向けの共通関数を提供する。
 */

/**
 * ホスト名が localhost / ローカルアドレスか判定する。
 *
 * @param hostname - 判定対象のホスト名
 * @returns ローカル系ホスト名なら true
 */
export function isLocalhost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.localdomain') ||
    lower.endsWith('.internal')
  );
}

/**
 * IP アドレスがプライベート/内部アドレスか判定する。
 *
 * @param ip - 判定対象の IP アドレス
 * @returns プライベート IP なら true
 */
export function isPrivateIP(ip: string): boolean {
  // IPv4 のプライベートレンジ判定
  const ipv4Match = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b, c] = ipv4Match.map(Number);

    // 0.0.0.0/8 - カレントネットワーク
    if (a === 0) return true;

    // 10.0.0.0/8 - プライベートネットワーク
    if (a === 10) return true;

    // 127.0.0.0/8 - ループバック
    if (a === 127) return true;

    // 169.254.0.0/16 - リンクローカル
    if (a === 169 && b === 254) return true;

    // 172.16.0.0/12 - プライベートネットワーク
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.168.0.0/16 - プライベートネットワーク
    if (a === 192 && b === 168) return true;

    // 100.64.0.0/10 - キャリアグレード NAT
    if (a === 100 && b >= 64 && b <= 127) return true;

    // 192.0.0.0/24 - IETF のプロトコル割り当て
    if (a === 192 && b === 0 && c === 0) return true;

    // 192.0.2.0/24 - ドキュメント用途（TEST-NET-1）
    if (a === 192 && b === 0 && c === 2) return true;

    // 198.18.0.0/15 - ベンチマーク用途
    if (a === 198 && (b === 18 || b === 19)) return true;

    // 198.51.100.0/24 - ドキュメント用途（TEST-NET-2）
    if (a === 198 && b === 51 && c === 100) return true;

    // 203.0.113.0/24 - ドキュメント用途（TEST-NET-3）
    if (a === 203 && b === 0 && c === 113) return true;

    // 224.0.0.0 以上 - マルチキャスト/予約領域
    if (a >= 224) return true;
  }

  // IPv6 のプライベートレンジ
  if (ip.startsWith('::1')) return true; // ループバック
  if (ip.startsWith('fe80:')) return true; // リンクローカル
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // ユニークローカル

  // IPv4-mapped IPv6 表記（例: ::ffff:192.168.1.1, ::ffff:0a00:0001）
  const ipLower = ip.toLowerCase();
  if (ipLower.startsWith('::ffff:')) {
    const rest = ipLower.slice('::ffff:'.length);
    // ドット10進表記を処理: ::ffff:192.168.1.1
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(rest)) {
      return isPrivateIP(rest);
    }
    // 16進表記を処理: ::ffff:c0a8:0101 → ドット10進へ変換
    const hexParts = rest.split(':');
    if (hexParts.length === 2) {
      const hi = parseInt(hexParts[0], 16);
      const lo = parseInt(hexParts[1], 16);
      if (!isNaN(hi) && !isNaN(lo)) {
        const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isPrivateIP(dotted);
      }
    }
  }

  return false;
}
