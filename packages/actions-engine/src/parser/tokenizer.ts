/**
 * Expression tokenizer
 * Handles lexical analysis of GitHub Actions expressions
 */

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
export type TokenType =
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

export interface Token {
  type: TokenType;
  value: string | number | boolean | null;
  raw: string;
}

/** Two-character operator lookup: first char -> second char -> operator string */
const TWO_CHAR_OPERATORS: Record<string, Record<string, string>> = {
  '=': { '=': '==' },
  '!': { '=': '!=' },
  '<': { '=': '<=' },
  '>': { '=': '>=' },
  '&': { '&': '&&' },
  '|': { '|': '||' },
};

// Regex patterns for tokenizer (hoisted to module level to avoid re-creation)
const RE_WHITESPACE = /\s/;
const RE_IDENTIFIER_START = /[a-zA-Z_]/;
const RE_IDENTIFIER_CHAR = /[a-zA-Z0-9_-]/;
const RE_DIGIT = /[0-9]/;

/**
 * Simple tokenizer for expressions
 */
export function tokenize(expr: string): Token[] {
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
