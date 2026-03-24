/**
 * RS256 Key Pair Generation Script for Platform JWT
 *
 * Usage:
 *   npx tsx scripts/generate-keys.ts
 *
 * This script generates an RS256 (RSA SHA-256) key pair for signing Platform JWTs.
 * The keys are output in PEM format suitable for use as Cloudflare Worker secrets.
 */

async function generateRS256KeyPair(): Promise<{ privateKey: string; publicKey: string }> {
  // Generate RSA key pair for RS256
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true, // extractable
    ['sign', 'verify']
  );

  // Export private key as PKCS#8
  const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const privateKeyBase64 = Buffer.from(privateKeyBuffer).toString('base64');
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${privateKeyBase64.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----`;

  // Export public key as SPKI
  const publicKeyBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const publicKeyBase64 = Buffer.from(publicKeyBuffer).toString('base64');
  const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${publicKeyBase64.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`;

  return { privateKey: privateKeyPem, publicKey: publicKeyPem };
}

async function main() {
  console.log('Generating RS256 key pair for Platform JWT...\n');

  // Security warning
  console.log('\x1b[33m' + '='.repeat(60) + '\x1b[0m');
  console.log('\x1b[33mSECURITY WARNING\x1b[0m');
  console.log('\x1b[33m' + '='.repeat(60) + '\x1b[0m');
  console.log('\x1b[33mThis script will output cryptographic keys to the console.');
  console.log('After copying the keys, please:');
  console.log('  1. Clear your terminal history (run: history -c && clear)');
  console.log('  2. Never share or commit these keys to version control');
  console.log('  3. Store the private key securely');
  console.log('  4. Consider using wrangler secret put directly instead\x1b[0m');
  console.log('\x1b[33m' + '='.repeat(60) + '\x1b[0m\n');

  const { privateKey, publicKey } = await generateRS256KeyPair();

  console.log('='.repeat(60));
  console.log('\x1b[31mPLATFORM_PRIVATE_KEY (takos-control only - KEEP SECRET!)\x1b[0m');
  console.log('='.repeat(60));
  console.log(privateKey);
  console.log();

  console.log('='.repeat(60));
  console.log('PLATFORM_PUBLIC_KEY (both takos-control and takos)');
  console.log('='.repeat(60));
  console.log(publicKey);
  console.log();

  console.log('='.repeat(60));
  console.log('Setup Instructions');
  console.log('='.repeat(60));
  console.log(`
1. For takos-control, set both keys as secrets:

   wrangler secret put PLATFORM_PRIVATE_KEY
   (paste the private key, then press Ctrl+D)

   wrangler secret put PLATFORM_PUBLIC_KEY
   (paste the public key, then press Ctrl+D)

2. For takos, set only the public key:

   cd ../takos
   wrangler secret put PLATFORM_PUBLIC_KEY
   (paste the public key, then press Ctrl+D)

3. For local development, add to .dev.vars files:

   apps/control/.dev.vars:
   PLATFORM_PRIVATE_KEY="<private key on single line with \\n>"
   PLATFORM_PUBLIC_KEY="<public key on single line with \\n>"

   takos/.dev.vars:
   PLATFORM_PUBLIC_KEY="<public key on single line with \\n>"

4. IMPORTANT: Clear your terminal history after copying the keys:

   On Linux/macOS:
   history -c && clear

   On Windows (PowerShell):
   Clear-History; Clear-Host

   On Windows (cmd):
   cls
`);

  console.log('\x1b[33m' + '='.repeat(60) + '\x1b[0m');
  console.log('\x1b[33mREMINDER: Clear your terminal history now!\x1b[0m');
  console.log('\x1b[33m' + '='.repeat(60) + '\x1b[0m');
}

main().catch(console.error);
