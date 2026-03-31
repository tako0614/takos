import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { onMount, onCleanup, createEffect } from 'solid-js';
import type { JSX } from 'solid-js';

const monacoGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (_moduleId: string, label: string) => Worker;
  };
};

if (!monacoGlobal.MonacoEnvironment) {
  monacoGlobal.MonacoEnvironment = {
    getWorker(_, label) {
      if (label === 'json') return new jsonWorker();
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
      if (label === 'typescript' || label === 'javascript') return new tsWorker();
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
  onMount?: (editor: monaco.editor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => void;
  class?: string;
  loading?: JSX.Element;
}

export default function MonacoEditor(props: MonacoEditorProps) {
  let containerRef: HTMLDivElement | undefined;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;

  onMount(() => {
    if (!containerRef) return;

    editor = monaco.editor.create(containerRef, {
      value: props.value ?? props.defaultValue ?? '',
      language: props.language ?? 'plaintext',
      theme: props.theme ?? 'vs-dark',
      automaticLayout: true,
      ...props.options,
    });

    editor.onDidChangeModelContent(() => {
      props.onChange?.(editor!.getValue());
    });

    props.onMount?.(editor, monaco);
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
    height: typeof props.height === 'number' ? `${props.height}px` : (props.height ?? '100%'),
    width: typeof props.width === 'number' ? `${props.width}px` : (props.width ?? '100%'),
  });

  return <div ref={containerRef} class={props.class} style={style()} />;
}
