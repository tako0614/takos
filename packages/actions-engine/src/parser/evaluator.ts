/**
 * 式の評価器
 * トークナイズ済み GitHub Actions 式のパースと評価を行う
 */
import { MAX_EVALUATE_CALLS, MAX_PARSE_ACCESS_DEPTH } from "../constants.ts";
import type { ExecutionContext } from "../workflow-models.ts";
import { ExpressionError } from "./tokenizer.ts";
import type { Token, TokenType } from "./tokenizer.ts";
import {
  fnAlways,
  fnCancelled,
  fnFailure,
  fnFormat,
  fnFromJSON,
  fnHashFiles,
  fnJoin,
  fnSuccess,
  fnToJSON,
} from "./evaluator-functions.ts";

const BLOCKED_PROPERTY_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const COMPARISON_OPERATORS = new Set(["==", "!=", "<", ">", "<=", ">="]);

/**
 * シンプルな式パーサー兼評価器
 */
export class ExpressionEvaluator {
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
        this.tokenSource(),
      );
    }
    return this.advance();
  }

  private tokenSource(): string {
    return this.tokens.map((t) => t.raw).join("");
  }

  private getIdentifierValue(token: Token): string {
    if (token.type !== "identifier" || typeof token.value !== "string") {
      const valueType = token.value === null ? "null" : typeof token.value;
      throw new ExpressionError(
        `Expected identifier token with string value but got ${token.type}(${valueType})`,
        this.expression,
      );
    }
    return token.value;
  }

  /**
   * 式をパースして評価する
   */
  evaluate(): unknown {
    this.evaluateCallCount++;
    if (this.evaluateCallCount > MAX_EVALUATE_CALLS) {
      throw new ExpressionError(
        `Expression evaluate call limit exceeded: ${MAX_EVALUATE_CALLS}`,
        this.expression,
      );
    }
    return this.parseOr();
  }

  private parseOr(): unknown {
    const left = this.parseAnd();
    while (this.current().value === "||") {
      throw new ExpressionError("Unsupported operator: ||", this.expression);
    }
    return left;
  }

  private parseAnd(): unknown {
    const left = this.parseComparison();
    while (this.current().value === "&&") {
      throw new ExpressionError("Unsupported operator: &&", this.expression);
    }
    return left;
  }

  private parseComparison(): unknown {
    const left = this.parseUnary();
    const op = this.current().value;
    if (typeof op === "string" && COMPARISON_OPERATORS.has(op)) {
      throw new ExpressionError(`Unsupported operator: ${op}`, this.expression);
    }
    return left;
  }

  private parseUnary(): unknown {
    if (this.current().value === "!") {
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
        this.expression,
      );
    }
  }

  private parseAccess(): unknown {
    let value = this.parsePrimary();
    let depth = 0;

    while (true) {
      if (this.match("dot")) {
        this.checkAccessDepth(++depth);
        const prop = this.getIdentifierValue(this.expect("identifier"));
        value = this.getProperty(value, prop);
      } else if (this.match("lbracket")) {
        this.checkAccessDepth(++depth);
        const index = this.evaluate();
        this.expect("rbracket");
        value = this.getProperty(value, index);
      } else {
        break;
      }
    }

    return value;
  }

  private parsePrimary(): unknown {
    const token = this.current();

    if (
      token.type === "string" || token.type === "number" ||
      token.type === "boolean"
    ) {
      this.advance();
      return token.value;
    }
    if (token.type === "null") {
      this.advance();
      return null;
    }

    if (token.type === "identifier") {
      const name = this.getIdentifierValue(this.advance());

      // 関数呼び出しか確認
      if (this.current().type === "lparen") {
        return this.parseFunction(name);
      }

      // コンテキスト変数
      return this.getContextValue(name);
    }

    if (token.type === "lparen") {
      this.advance();
      const value = this.evaluate();
      this.expect("rparen");
      return value;
    }

    throw new ExpressionError(
      `Unexpected token: ${token.type}`,
      this.tokenSource(),
    );
  }

  private parseFunction(name: string): unknown {
    this.expect("lparen");
    const args: unknown[] = [];

    if (this.current().type !== "rparen") {
      args.push(this.evaluate());
      while (this.match("comma")) {
        args.push(this.evaluate());
      }
    }

    this.expect("rparen");
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
    if (typeof obj === "object") {
      return (obj as Record<string, unknown>)[keyString];
    }
    return undefined;
  }

  private compare(left: unknown, op: string, right: unknown): boolean {
    if (op === "==" || op === "!=") {
      return op === "==" ? left === right : left !== right;
    }

    const NUMERIC_OPERATORS: Record<string, (l: number, r: number) => boolean> =
      {
        "<": (l, r) => l < r,
        ">": (l, r) => l > r,
        "<=": (l, r) => l <= r,
        ">=": (l, r) => l >= r,
      };

    const numericOp = NUMERIC_OPERATORS[op];
    if (!numericOp) {
      throw new ExpressionError(
        `Unknown comparison operator: ${op}`,
        this.expression,
      );
    }

    const l = Number(left);
    const r = Number(right);
    if (Number.isNaN(l) || Number.isNaN(r)) {
      throw new ExpressionError(
        `Comparison operator '${op}' received a NaN operand`,
        this.expression,
      );
    }
    return numericOp(l, r);
  }

  private toBoolean(value: unknown): boolean {
    if (value === null || value === undefined || value === "") {
      return false;
    }
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    if (typeof value === "string") {
      return value.length > 0;
    }
    return true;
  }

  private callFunction(name: string, args: unknown[]): unknown {
    const FUNCTIONS: Record<string, () => unknown> = {
      "format": () => fnFormat(args),
      "join": () => fnJoin(args),
      "toJSON": () => fnToJSON(args),
      "fromJSON": () => fnFromJSON(args),
      "hashFiles": () => fnHashFiles(args, this.context),
      "success": () => fnSuccess(this.context),
      "always": () => fnAlways(),
      "cancelled": () => fnCancelled(this.context),
      "failure": () => fnFailure(this.context),
    };

    const fn = FUNCTIONS[name];
    if (!fn) {
      throw new ExpressionError(
        `Unknown function: ${name}`,
        this.tokenSource(),
      );
    }
    return fn();
  }
}
