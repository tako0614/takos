/**
 * GitHub Actions expression evaluator
 * Handles ${{ }} expressions with variable substitution and simple evaluation
 */
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import type { ExecutionContext } from '../types.js';

/**
 * Expression evaluation error
 */
/** @internal - not re-exported from the package index */
export class ExpressionError extends Error {
  constructor(
    message: string,
    public readonly expression: string
  ) {
    super(message);
    this.name = 'ExpressionError';
  }
}

/**
 * Token types for expression lexer
 */
type TokenType =
  | 'identifier'
  | 'number'
  | 'string'
  | 'boolean'
  | 'null'
  | 'operator'
  | 'dot'
  | 'lparen'
  | 'rparen'
  | 'lbracket'
  | 'rbracket'
  | 'comma'
  | 'eof';

interface Token {
  type: TokenType;
  value: string | number | boolean | null;
  raw: string;
}

const MAX_EXPRESSION_SIZE = 64 * 1024;
const MAX_EVALUATE_CALLS = 10_000;
const MAX_PARSE_ACCESS_DEPTH = 128;
const BLOCKED_PROPERTY_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const GLOB_PATTERN_CHARS = /[*?[\]]/;
const REGEXP_META_CHARS = /[|\\{}()[\]^$+?.]/g;
const COMPARISON_OPERATORS = new Set(['==', '!=', '<', '>', '<=', '>=']);

/** Two-character operator lookup: first char -> second char -> operator string */
const TWO_CHAR_OPERATORS: Record<string, Record<string, string>> = {
  '=': { '=': '==' },
  '!': { '=': '!=' },
  '<': { '=': '<=' },
  '>': { '=': '>=' },
  '&': { '&': '&&' },
  '|': { '|': '||' },
};

function normalizePathLike(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function containsGlobPattern(pattern: string): boolean {
  return GLOB_PATTERN_CHARS.test(pattern);
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePathLike(pattern);
  let regex = '^';

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (char === '*') {
      if (normalized[i + 1] === '*') {
        regex += '.*';
        i++;
      } else {
        regex += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      regex += '[^/]';
      continue;
    }

    regex += char.replace(REGEXP_META_CHARS, '\\$&');
  }

  regex += '$';
  return new RegExp(regex);
}

function isInsideWorkspace(workspace: string, targetPath: string): boolean {
  const relativePath = relative(workspace, targetPath);
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  );
}

function collectWorkspaceFiles(workspace: string): string[] {
  const files: string[] = [];
  const queue = [workspace];

  while (queue.length > 0) {
    const currentDir = queue.pop();
    if (!currentDir) {
      continue;
    }

    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absolutePath = resolve(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const relativePath = normalizePathLike(relative(workspace, absolutePath));
      if (relativePath.length > 0) {
        files.push(relativePath);
      }
    }
  }

  files.sort();
  return files;
}

function resolveWorkspaceFile(
  workspace: string,
  fileOrRelativePath: string
): string | null {
  const absolutePath = isAbsolute(fileOrRelativePath)
    ? resolve(fileOrRelativePath)
    : resolve(workspace, fileOrRelativePath);

  if (!isInsideWorkspace(workspace, absolutePath)) {
    return null;
  }

  try {
    if (!lstatSync(absolutePath).isFile()) {
      return null;
    }
  } catch {
    return null;
  }

  return normalizePathLike(relative(workspace, absolutePath));
}

function hashFileSha256(filePath: string): string | null {
  try {
    const content = readFileSync(filePath);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

// Regex patterns for tokenizer (hoisted to module level to avoid re-creation)
const RE_WHITESPACE = /\s/;
const RE_IDENTIFIER_START = /[a-zA-Z_]/;
const RE_IDENTIFIER_CHAR = /[a-zA-Z0-9_-]/;
const RE_DIGIT = /[0-9]/;

/**
 * Simple tokenizer for expressions
 */
function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < expr.length) {
    const char = expr[pos];

    // Skip whitespace
    if (RE_WHITESPACE.test(char)) {
      pos++;
      continue;
    }

    // Operators -- check two-char operators first via lookup table
    const twoCharOp = TWO_CHAR_OPERATORS[char]?.[expr[pos + 1]];
    if (twoCharOp !== undefined) {
      tokens.push({ type: 'operator', value: twoCharOp, raw: twoCharOp });
      pos += 2;
      continue;
    }
    if (char === '<' || char === '>') {
      tokens.push({ type: 'operator', value: char, raw: char });
      pos++;
      continue;
    }
    if (char === '!') {
      tokens.push({ type: 'operator', value: '!', raw: '!' });
      pos++;
      continue;
    }

    // Punctuation
    if (char === '.') {
      tokens.push({ type: 'dot', value: '.', raw: '.' });
      pos++;
      continue;
    }
    if (char === '(') {
      tokens.push({ type: 'lparen', value: '(', raw: '(' });
      pos++;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'rparen', value: ')', raw: ')' });
      pos++;
      continue;
    }
    if (char === '[') {
      tokens.push({ type: 'lbracket', value: '[', raw: '[' });
      pos++;
      continue;
    }
    if (char === ']') {
      tokens.push({ type: 'rbracket', value: ']', raw: ']' });
      pos++;
      continue;
    }
    if (char === ',') {
      tokens.push({ type: 'comma', value: ',', raw: ',' });
      pos++;
      continue;
    }

    // String literals
    if (char === "'" || char === '"') {
      const quote = char;
      let value = '';
      pos++;
      while (pos < expr.length && expr[pos] !== quote) {
        if (expr[pos] === '\\' && pos + 1 < expr.length) {
          pos++;
          const escaped = expr[pos];
          if (escaped === 'n') value += '\n';
          else if (escaped === 't') value += '\t';
          else if (escaped === 'r') value += '\r';
          else value += escaped;
        } else {
          value += expr[pos];
        }
        pos++;
      }
      pos++; // Skip closing quote
      tokens.push({ type: 'string', value, raw: `${quote}${value}${quote}` });
      continue;
    }

    // Numbers
    if (RE_DIGIT.test(char) || (char === '-' && RE_DIGIT.test(expr[pos + 1] || ''))) {
      let raw = '';
      if (char === '-') {
        raw += char;
        pos++;
      }
      while (pos < expr.length && (RE_DIGIT.test(expr[pos]) || expr[pos] === '.')) {
        raw += expr[pos];
        pos++;
      }
      const value = raw.includes('.') ? parseFloat(raw) : parseInt(raw, 10);
      tokens.push({ type: 'number', value, raw });
      continue;
    }

    // Identifiers and keywords
    if (RE_IDENTIFIER_START.test(char)) {
      let raw = '';
      while (pos < expr.length && RE_IDENTIFIER_CHAR.test(expr[pos])) {
        raw += expr[pos];
        pos++;
      }
      // Check for keywords
      if (raw === 'true') {
        tokens.push({ type: 'boolean', value: true, raw });
      } else if (raw === 'false') {
        tokens.push({ type: 'boolean', value: false, raw });
      } else if (raw === 'null') {
        tokens.push({ type: 'null', value: null, raw });
      } else {
        tokens.push({ type: 'identifier', value: raw, raw });
      }
      continue;
    }

    // Unknown character
    throw new ExpressionError(`Unexpected character: ${char}`, expr);
  }

  tokens.push({ type: 'eof', value: null, raw: '' });
  return tokens;
}

/**
 * Simple expression parser and evaluator
 */
class ExpressionEvaluator {
  private readonly tokens: Token[];
  private pos: number;
  private readonly context: ExecutionContext;
  private readonly expression: string;
  private evaluateCallCount: number;
  private readonly contextMap: Readonly<Record<string, unknown>>;

  constructor(tokens: Token[], context: ExecutionContext, expression: string) {
    this.tokens = tokens;
    this.pos = 0;
    this.context = context;
    this.expression = expression;
    this.evaluateCallCount = 0;
    this.contextMap = {
      github: context.github,
      env: context.env,
      vars: context.vars,
      secrets: context.secrets,
      runner: context.runner,
      job: context.job,
      steps: context.steps,
      needs: context.needs,
      strategy: context.strategy,
      matrix: context.matrix,
      inputs: context.inputs,
    };
  }

  private current(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const token = this.current();
    this.pos++;
    return token;
  }

  private match(type: TokenType): boolean {
    if (this.current().type === type) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(type: TokenType): Token {
    const token = this.current();
    if (token.type !== type) {
      throw new ExpressionError(
        `Expected ${type} but got ${token.type}`,
        this.tokenSource()
      );
    }
    return this.advance();
  }

  private tokenSource(): string {
    return this.tokens.map((t) => t.raw).join('');
  }

  private getIdentifierValue(token: Token): string {
    if (token.type !== 'identifier' || typeof token.value !== 'string') {
      const valueType = token.value === null ? 'null' : typeof token.value;
      throw new ExpressionError(
        `Expected identifier token with string value but got ${token.type}(${valueType})`,
        this.expression
      );
    }
    return token.value;
  }

  /**
   * Parse and evaluate expression
   */
  evaluate(): unknown {
    this.evaluateCallCount++;
    if (this.evaluateCallCount > MAX_EVALUATE_CALLS) {
      throw new ExpressionError(
        `Expression evaluate call limit exceeded: ${MAX_EVALUATE_CALLS}`,
        this.expression
      );
    }
    return this.parseOr();
  }

  private parseOr(): unknown {
    let left = this.parseAnd();
    while (this.current().value === '||') {
      this.advance();
      const right = this.parseAnd();
      left = this.toBoolean(left) || this.toBoolean(right);
    }
    return left;
  }

  private parseAnd(): unknown {
    let left = this.parseComparison();
    while (this.current().value === '&&') {
      this.advance();
      const right = this.parseComparison();
      left = this.toBoolean(left) && this.toBoolean(right);
    }
    return left;
  }

  private parseComparison(): unknown {
    const left = this.parseUnary();
    const op = this.current().value;
    if (typeof op === 'string' && COMPARISON_OPERATORS.has(op)) {
      this.advance();
      const right = this.parseUnary();
      return this.compare(left, op, right);
    }
    return left;
  }

  private parseUnary(): unknown {
    if (this.current().value === '!') {
      this.advance();
      const value = this.parseUnary();
      return !this.toBoolean(value);
    }
    return this.parseAccess();
  }

  private checkAccessDepth(depth: number): void {
    if (depth > MAX_PARSE_ACCESS_DEPTH) {
      throw new ExpressionError(
        `Expression access depth limit exceeded: ${MAX_PARSE_ACCESS_DEPTH}`,
        this.expression
      );
    }
  }

  private parseAccess(): unknown {
    let value = this.parsePrimary();
    let depth = 0;

    while (true) {
      if (this.match('dot')) {
        this.checkAccessDepth(++depth);
        const prop = this.getIdentifierValue(this.expect('identifier'));
        value = this.getProperty(value, prop);
      } else if (this.match('lbracket')) {
        this.checkAccessDepth(++depth);
        const index = this.evaluate();
        this.expect('rbracket');
        value = this.getProperty(value, index);
      } else {
        break;
      }
    }

    return value;
  }

  private parsePrimary(): unknown {
    const token = this.current();

    if (token.type === 'string' || token.type === 'number' || token.type === 'boolean') {
      this.advance();
      return token.value;
    }
    if (token.type === 'null') {
      this.advance();
      return null;
    }

    if (token.type === 'identifier') {
      const name = this.getIdentifierValue(this.advance());

      // Check if it's a function call
      if (this.current().type === 'lparen') {
        return this.parseFunction(name);
      }

      // Context variable
      return this.getContextValue(name);
    }

    if (token.type === 'lparen') {
      this.advance();
      const value = this.evaluate();
      this.expect('rparen');
      return value;
    }

    throw new ExpressionError(
      `Unexpected token: ${token.type}`,
      this.tokenSource()
    );
  }

  private parseFunction(name: string): unknown {
    this.expect('lparen');
    const args: unknown[] = [];

    if (this.current().type !== 'rparen') {
      args.push(this.evaluate());
      while (this.match('comma')) {
        args.push(this.evaluate());
      }
    }

    this.expect('rparen');
    return this.callFunction(name, args);
  }

  private getContextValue(name: string): unknown {
    return this.contextMap[name];
  }

  private getProperty(obj: unknown, key: unknown): unknown {
    if (obj === null || obj === undefined) {
      return undefined;
    }
    const keyString = String(key);
    if (BLOCKED_PROPERTY_KEYS.has(keyString)) {
      return undefined;
    }
    if (typeof obj === 'object') {
      return (obj as Record<string, unknown>)[keyString];
    }
    return undefined;
  }

  private compare(left: unknown, op: string, right: unknown): boolean {
    switch (op) {
      case '==':
        return left === right;
      case '!=':
        return left !== right;
      case '<':
      case '>':
      case '<=':
      case '>=': {
        const l = Number(left);
        const r = Number(right);
        if (Number.isNaN(l) || Number.isNaN(r)) {
          throw new ExpressionError(
            `Comparison operator '${op}' received a NaN operand`,
            this.expression
          );
        }
        if (op === '<') return l < r;
        if (op === '>') return l > r;
        if (op === '<=') return l <= r;
        return l >= r;
      }
      default:
        throw new ExpressionError(
          `Unknown comparison operator: ${op}`,
          this.expression
        );
    }
  }

  private toBoolean(value: unknown): boolean {
    if (value === null || value === undefined || value === '') {
      return false;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (typeof value === 'string') {
      return value.length > 0;
    }
    return true;
  }

  private callFunction(name: string, args: unknown[]): unknown {
    switch (name) {
      case 'contains':
        return this.fnContains(args);
      case 'startsWith':
        return this.fnStartsWith(args);
      case 'endsWith':
        return this.fnEndsWith(args);
      case 'format':
        return this.fnFormat(args);
      case 'join':
        return this.fnJoin(args);
      case 'toJSON':
        return this.fnToJSON(args);
      case 'fromJSON':
        return this.fnFromJSON(args);
      case 'hashFiles':
        return this.fnHashFiles(args);
      case 'success':
        return this.fnSuccess();
      case 'always':
        return this.fnAlways();
      case 'cancelled':
        return this.fnCancelled();
      case 'failure':
        return this.fnFailure();
      default:
        throw new ExpressionError(
          `Unknown function: ${name}`,
          this.tokenSource()
        );
    }
  }

  private fnContains(args: unknown[]): boolean {
    const [search, item] = args;
    if (typeof search === 'string') {
      return search.toLowerCase().includes(String(item).toLowerCase());
    }
    if (Array.isArray(search)) {
      return search.includes(item);
    }
    return false;
  }

  private fnStartsWith(args: unknown[]): boolean {
    const [str, searchStr] = args;
    return String(str).toLowerCase().startsWith(String(searchStr).toLowerCase());
  }

  private fnEndsWith(args: unknown[]): boolean {
    const [str, searchStr] = args;
    return String(str).toLowerCase().endsWith(String(searchStr).toLowerCase());
  }

  private fnFormat(args: unknown[]): string {
    const [template, ...values] = args;
    if (template === null || template === undefined) {
      return '';
    }
    let result = String(template);
    for (let i = 0; i < values.length; i++) {
      result = result.split(`{${i}}`).join(String(values[i]));
    }
    return result;
  }

  private fnJoin(args: unknown[]): string {
    const [arr, separator = ','] = args;
    if (Array.isArray(arr)) {
      return arr.join(String(separator));
    }
    return String(arr);
  }

  private fnToJSON(args: unknown[]): string {
    return JSON.stringify(args[0]);
  }

  private fnFromJSON(args: unknown[]): unknown {
    const str = String(args[0]);
    // Limit input size to prevent OOM from attacker-controlled JSON strings
    if (str.length > 1_048_576) { // 1MB
      return null;
    }
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  private fnHashFiles(args: unknown[]): string {
    const includePatterns: string[] = [];
    const excludePatterns: string[] = [];

    for (const arg of args) {
      if (typeof arg !== 'string') {
        continue;
      }

      const pattern = arg.trim();
      if (pattern.length === 0) {
        continue;
      }

      if (pattern.startsWith('!') && pattern.length > 1) {
        excludePatterns.push(pattern.slice(1));
      } else {
        includePatterns.push(pattern);
      }
    }

    if (includePatterns.length === 0) {
      return '';
    }

    return this.evaluateHashFiles(includePatterns, excludePatterns);
  }

  private evaluateHashFiles(
    includePatterns: string[],
    excludePatterns: string[]
  ): string {
    const workspace = resolve(this.context.github.workspace || process.cwd());
    const files = this.collectMatchedHashFiles(
      workspace,
      includePatterns,
      excludePatterns
    );
    if (files.length === 0) {
      return '';
    }

    const fileHashes = this.hashFiles(workspace, files);
    if (fileHashes.length === 0) {
      return '';
    }
    if (fileHashes.length === 1) {
      return fileHashes[0];
    }

    const aggregate = createHash('sha256');
    for (const fileHash of fileHashes) {
      aggregate.update(fileHash);
    }
    return aggregate.digest('hex');
  }

  private collectMatchedHashFiles(
    workspace: string,
    includePatterns: string[],
    excludePatterns: string[]
  ): string[] {
    const matchedFiles = new Set<string>();
    let workspaceFiles: string[] | undefined;

    const applyPattern = (pattern: string, include: boolean): void => {
      if (containsGlobPattern(pattern)) {
        workspaceFiles ??= collectWorkspaceFiles(workspace);
        const regexp = globToRegExp(pattern);
        for (const file of workspaceFiles) {
          if (regexp.test(file)) {
            if (include) {
              matchedFiles.add(file);
            } else {
              matchedFiles.delete(file);
            }
          }
        }
        return;
      }

      const file = resolveWorkspaceFile(workspace, pattern);
      if (!file) {
        return;
      }
      if (include) {
        matchedFiles.add(file);
      } else {
        matchedFiles.delete(file);
      }
    };

    for (const pattern of includePatterns) {
      applyPattern(pattern, true);
    }
    for (const pattern of excludePatterns) {
      applyPattern(pattern, false);
    }

    return [...matchedFiles].sort();
  }

  private hashFiles(workspace: string, files: string[]): string[] {
    const fileHashes: string[] = [];
    for (const file of files) {
      const fileHash = hashFileSha256(resolve(workspace, file));
      if (fileHash) {
        fileHashes.push(fileHash);
      }
    }
    return fileHashes;
  }

  private fnSuccess(): boolean {
    return this.context.job.status === 'success';
  }

  private fnAlways(): boolean {
    return true;
  }

  private fnCancelled(): boolean {
    return this.context.job.status === 'cancelled';
  }

  private fnFailure(): boolean {
    return this.context.job.status === 'failure';
  }
}

/**
 * Extract expression content from ${{ }} wrapper.
 * Returns the inner expression if wrapped, or the input unchanged.
 */
function extractExpression(expr: string): string {
  const match = expr.match(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/);
  return match ? match[1] : expr;
}

/**
 * Evaluate a single expression
 */
/** @internal - not re-exported from the package index */
export function evaluateExpression(
  expr: string,
  context: ExecutionContext
): unknown {
  const innerExpr = extractExpression(expr);
  if (innerExpr.length > MAX_EXPRESSION_SIZE) {
    throw new ExpressionError(
      `Expression size limit exceeded: ${MAX_EXPRESSION_SIZE}`,
      expr
    );
  }
  const tokens = tokenize(innerExpr);
  const evaluator = new ExpressionEvaluator(tokens, context, innerExpr);
  return evaluator.evaluate();
}

/** Pattern for matching ${{ }} expressions */
const EXPRESSION_PATTERN = /\$\{\{([\s\S]+?)\}\}/g;

/**
 * Interpolate all expressions in a string
 */
export function interpolateString(
  template: string,
  context: ExecutionContext
): string {
  return template.replace(EXPRESSION_PATTERN, (match) => {
    try {
      const result = evaluateExpression(match, context);
      if (result === undefined || result === null) {
        return '';
      }
      if (typeof result === 'object') {
        return JSON.stringify(result);
      }
      return String(result);
    } catch (err) {
      // Log the error for debugging but return empty string to avoid
      // exposing raw ${{ }} expressions in workflow output.
      if (typeof process !== 'undefined' && process.stderr) {
        process.stderr.write(`[actions-engine] Expression evaluation error: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      return '';
    }
  });
}

/**
 * Convert an expression result to a condition boolean.
 *
 * This intentionally differs from the evaluator's internal toBoolean():
 * the string 'false' is treated as falsy, matching GitHub Actions behavior
 * for `if:` conditions.
 */
function resultToConditionBoolean(result: unknown): boolean {
  if (result === null || result === undefined || result === '') {
    return false;
  }
  if (typeof result === 'boolean') {
    return result;
  }
  if (typeof result === 'number') {
    return result !== 0;
  }
  if (typeof result === 'string') {
    return result.length > 0 && result !== 'false';
  }
  return true;
}

/**
 * Evaluate a condition (if: expression)
 */
export function evaluateCondition(
  condition: string | undefined,
  context: ExecutionContext
): boolean {
  if (condition === undefined || condition === '') {
    return true;
  }

  try {
    // If not wrapped in ${{ }}, wrap it
    const expr = condition.startsWith('${{')
      ? condition
      : `\${{ ${condition} }}`;
    const result = evaluateExpression(expr, context);
    return resultToConditionBoolean(result);
  } catch {
    return false;
  }
}

/**
 * Interpolate environment variables and expressions in an object
 */
export function interpolateObject<T extends Record<string, unknown>>(
  obj: T,
  context: ExecutionContext
): T {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = interpolateString(value, context);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === 'string'
          ? interpolateString(item, context)
          : typeof item === 'object' && item !== null
            ? interpolateObject(item as Record<string, unknown>, context)
            : item
      );
    } else if (typeof value === 'object' && value !== null) {
      result[key] = interpolateObject(
        value as Record<string, unknown>,
        context
      );
    } else {
      result[key] = value;
    }
  }

  return result as T;
}
