import type { ReactNode } from 'react';

export function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <code className="text-zinc-300">{children}</code>
    </pre>
  );
}

export function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800">
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-medium text-zinc-300">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-zinc-800/50">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2 text-zinc-400">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-8 mb-3 text-xl font-semibold text-zinc-200">{children}</h2>;
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-6 mb-2 text-lg font-medium text-zinc-300">{children}</h3>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mb-4 leading-relaxed text-zinc-400">{children}</p>;
}

export function Endpoint({ method, path, desc }: { method: string; path: string; desc?: string }) {
  const colors: Record<string, string> = {
    GET: 'text-emerald-400',
    POST: 'text-blue-400',
    PUT: 'text-amber-400',
    PATCH: 'text-orange-400',
    DELETE: 'text-red-400',
  };
  return (
    <div className="flex items-center gap-2 text-sm font-mono">
      <span className={`font-bold ${colors[method] || 'text-zinc-400'}`}>{method}</span>
      <span className="text-zinc-400">{path}</span>
      {desc && <span className="text-zinc-600 text-xs">— {desc}</span>}
    </div>
  );
}
