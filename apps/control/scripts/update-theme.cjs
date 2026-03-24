const fs = require('fs');
const path = require('path');

const replacements = [
  // アクセントカラー: emerald → 黒
  ['emerald-500', 'zinc-900'],
  ['emerald-600', 'zinc-800'],
  ['emerald-400', 'zinc-700'],
  ['emerald-300', 'zinc-600'],
  ['emerald-200', 'zinc-500'],

  // 背景色 (ダーク→ライト)
  ['bg-zinc-950', 'bg-zinc-50'],
  ['bg-zinc-900', 'bg-white'],
  ['bg-zinc-800', 'bg-zinc-100'],
  ['bg-zinc-700', 'bg-zinc-200'],

  // テキスト色 (明→暗)
  ['text-zinc-100', 'text-zinc-900'],
  ['text-zinc-200', 'text-zinc-800'],
  ['text-zinc-300', 'text-zinc-700'],
  ['text-zinc-400', 'text-zinc-500'],

  // ボーダー
  ['border-zinc-700', 'border-zinc-200'],
  ['border-zinc-600', 'border-zinc-300'],
  ['border-zinc-800', 'border-zinc-100'],

  // ホバー背景
  ['hover:bg-zinc-800', 'hover:bg-zinc-100'],
  ['hover:bg-zinc-700', 'hover:bg-zinc-200'],

  // その他
  ['divide-zinc-700', 'divide-zinc-200'],
  ['ring-zinc-700', 'ring-zinc-200'],
  ['placeholder-zinc-500', 'placeholder-zinc-400'],
];

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  for (const [from, to] of replacements) {
    if (content.includes(from)) {
      content = content.split(from).join(to);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, content);
    console.log('Updated:', filePath);
  }
}

function walkDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      walkDir(filePath);
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      processFile(filePath);
    }
  }
}

walkDir(path.join(__dirname, '../web/src'));
console.log('Done!');
