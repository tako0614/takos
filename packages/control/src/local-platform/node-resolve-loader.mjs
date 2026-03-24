import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, extname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const TS_CANDIDATE_SUFFIXES = ['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js', '/index.mjs'];

async function fileExists(pathname) {
  try {
    await access(pathname, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') {
    return {
      url: new URL('./cloudflare-workers-shim.mjs', import.meta.url).href,
      shortCircuit: true,
    };
  }

  if (specifier === '@cloudflare/containers') {
    return {
      url: new URL('./cloudflare-containers-shim.mjs', import.meta.url).href,
      shortCircuit: true,
    };
  }

  if (specifier.endsWith('.md')) {
    return {
      url: new URL(specifier, context.parentURL).href,
      shortCircuit: true,
    };
  }

  if (
    context.parentURL?.startsWith('file:') &&
    (specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')) &&
    extname(specifier) === ''
  ) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const absoluteBase = specifier.startsWith('/')
      ? specifier
      : resolvePath(parentDir, specifier);

    for (const suffix of TS_CANDIDATE_SUFFIXES) {
      const candidate = `${absoluteBase}${suffix}`;
      if (await fileExists(candidate)) {
        return {
          url: pathToFileURL(candidate).href,
          shortCircuit: true,
        };
      }
    }
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.md')) {
    const source = await readFile(new URL(url), 'utf8');
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(source)};`,
    };
  }

  if (url.endsWith('.ts') || url.endsWith('.tsx')) {
    const source = await readFile(new URL(url), 'utf8');
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: url.endsWith('.tsx') ? ts.JsxEmit.ReactJSX : ts.JsxEmit.None,
        jsxImportSource: 'hono/jsx',
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowImportingTsExtensions: true,
        sourceMap: false,
        inlineSourceMap: false,
      },
      fileName: fileURLToPath(url),
    });
    return {
      format: 'module',
      shortCircuit: true,
      source: transpiled.outputText,
    };
  }

  return nextLoad(url, context);
}
