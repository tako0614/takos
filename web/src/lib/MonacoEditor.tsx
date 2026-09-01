import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import "monaco-editor/esm/vs/language/css/monaco.contribution.js";
import "monaco-editor/esm/vs/language/html/monaco.contribution.js";
import "monaco-editor/esm/vs/language/json/monaco.contribution.js";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution.js";
import "monaco-editor/esm/vs/basic-languages/bat/bat.contribution.js";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js";
import "monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js";
import "monaco-editor/esm/vs/basic-languages/css/css.contribution.js";
import "monaco-editor/esm/vs/basic-languages/dart/dart.contribution.js";
import "monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution.js";
import "monaco-editor/esm/vs/basic-languages/go/go.contribution.js";
import "monaco-editor/esm/vs/basic-languages/graphql/graphql.contribution.js";
import "monaco-editor/esm/vs/basic-languages/html/html.contribution.js";
import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js";
import "monaco-editor/esm/vs/basic-languages/java/java.contribution.js";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution.js";
import "monaco-editor/esm/vs/basic-languages/less/less.contribution.js";
import "monaco-editor/esm/vs/basic-languages/lua/lua.contribution.js";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js";
import "monaco-editor/esm/vs/basic-languages/perl/perl.contribution.js";
import "monaco-editor/esm/vs/basic-languages/php/php.contribution.js";
import "monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution.js";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution.js";
import "monaco-editor/esm/vs/basic-languages/r/r.contribution.js";
import "monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js";
import "monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js";
import "monaco-editor/esm/vs/basic-languages/scss/scss.contribution.js";
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js";
import "monaco-editor/esm/vs/basic-languages/swift/swift.contribution.js";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";
import { createEffect, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";

// The Monaco package root registers every bundled language plus its LSP client.
// Storage only exposes the languages above, so keep this editor on the smaller
// editor API and register the one supported format Monaco does not provide.
monaco.languages.register({
  id: "diff",
  extensions: [".diff", ".patch"],
  aliases: ["Diff", "diff", "Patch", "patch"],
});
monaco.languages.setMonarchTokensProvider("diff", {
  tokenizer: {
    root: [
      [/^diff\s.*$/u, "keyword"],
      [/^index\s.*$/u, "meta"],
      [/^(---|\+\+\+)\s.*$/u, "metatag"],
      [/^@@.*@@.*$/u, "number"],
      [/^\+.*$/u, "inserted"],
      [/^-.*$/u, "deleted"],
    ],
  },
});
monaco.editor.defineTheme("takos-vs", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "inserted.diff", foreground: "008000" },
    { token: "deleted.diff", foreground: "CD3131" },
  ],
  colors: {},
});
monaco.editor.defineTheme("takos-vs-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "inserted.diff", foreground: "6A9955" },
    { token: "deleted.diff", foreground: "F44747" },
  ],
  colors: {},
});

type MonacoEditorApi = typeof import(
  "monaco-editor/esm/vs/editor/editor.api.js"
);

const monacoGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (_moduleId: string, label: string) => Worker;
  };
};

if (!monacoGlobal.MonacoEnvironment) {
  monacoGlobal.MonacoEnvironment = {
    getWorker(_, label) {
      if (label === "json") return new jsonWorker();
      if (label === "css" || label === "scss" || label === "less") {
        return new cssWorker();
      }
      if (label === "html" || label === "handlebars" || label === "razor") {
        return new htmlWorker();
      }
      if (label === "typescript" || label === "javascript") {
        return new tsWorker();
      }
      return new editorWorker();
    },
  };
}

interface MonacoEditorProps {
  value?: string;
  defaultValue?: string;
  language?: string;
  theme?: string;
  height?: string | number;
  width?: string | number;
  options?: monaco.editor.IStandaloneEditorConstructionOptions;
  onChange?: (value: string | undefined) => void;
  onMount?: (
    editor: monaco.editor.IStandaloneCodeEditor,
    monaco: MonacoEditorApi,
  ) => void;
  inputName?: string;
  class?: string;
}

export default function MonacoEditor(props: MonacoEditorProps) {
  let containerRef: HTMLDivElement | undefined;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;

  onMount(() => {
    if (!containerRef) return;

    const createdEditor = monaco.editor.create(containerRef, {
      value: props.value ?? props.defaultValue ?? "",
      language: props.language ?? "plaintext",
      theme: props.theme ?? "vs-dark",
      automaticLayout: true,
      ...props.options,
    });
    editor = createdEditor;

    if (props.inputName) {
      for (const input of containerRef.querySelectorAll("textarea")) {
        input.name = props.inputName;
      }
    }

    createdEditor.onDidChangeModelContent(() => {
      props.onChange?.(createdEditor.getValue());
    });

    props.onMount?.(createdEditor, monaco);
  });

  createEffect(() => {
    if (!editor) return;
    const currentValue = editor.getValue();
    if (props.value !== undefined && props.value !== currentValue) {
      editor.setValue(props.value);
    }
  });

  createEffect(() => {
    if (!editor) return;
    if (props.language) {
      const model = editor.getModel();
      if (model) {
        monaco.editor.setModelLanguage(model, props.language);
      }
    }
  });

  createEffect(() => {
    if (!editor) return;
    if (props.theme) {
      monaco.editor.setTheme(props.theme);
    }
  });

  onCleanup(() => {
    editor?.dispose();
  });

  const style = (): JSX.CSSProperties => ({
    height:
      typeof props.height === "number"
        ? `${props.height}px`
        : (props.height ?? "100%"),
    width:
      typeof props.width === "number"
        ? `${props.width}px`
        : (props.width ?? "100%"),
  });

  return <div ref={containerRef} class={props.class} style={style()} />;
}
