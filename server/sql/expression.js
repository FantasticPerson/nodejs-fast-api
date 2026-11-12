export class ExpressionError extends Error {
  constructor(message, position = null) {
    super(message);
    this.name = 'ExpressionError';
    this.code = 'EXPRESSION_ERROR';
    this.position = position;
  }
}

const expressionCache = new Map();
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function compileExpression(source) {
  const text = String(source ?? '').trim();
  if (!text) throw new ExpressionError('表达式不能为空');
  if (expressionCache.has(text)) return expressionCache.get(text);
  const tokens = tokenize(text);
  const parser = new Parser(tokens, text);
  const compiled = parser.parse();
  if (expressionCache.size > 500) expressionCache.clear();
  expressionCache.set(text, compiled);
  return compiled;
}

export function evaluateExpression(source, context = {}) {
  return evaluate(compileExpression(source), context);
}

export function evaluateCompiled(compiled, context = {}) {
  return evaluate(compiled, context);
}

function evaluate(node, context) {
  switch (node.type) {
    case 'literal':
      return node.value;
    case 'path':
      return readPath(context, node.segments);
    case 'unary':
      return node.operator === '!' ? !truthy(evaluate(node.argument, context)) : !truthy(evaluate(node.argument, context));
    case 'binary':
      return evaluateBinary(node, context);
    default:
      return undefined;
  }
}

function evaluateBinary(node, context) {
  if (node.operator === '&&' || node.operator === 'and') {
    const left = evaluate(node.left, context);
    if (!truthy(left)) return false;
    return truthy(evaluate(node.right, context));
  }
  if (node.operator === '||' || node.operator === 'or') {
    const left = evaluate(node.left, context);
    if (truthy(left)) return true;
    return truthy(evaluate(node.right, context));
  }

  const left = evaluate(node.left, context);
  const right = evaluate(node.right, context);
  switch (node.operator) {
    case '==':
    case '===':
      return nullishEqual(left, right);
    case '!=':
    case '!==':
      return !nullishEqual(left, right);
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    default:
      throw new ExpressionError(`不支持的运算符：${node.operator}`);
  }
}

function nullishEqual(left, right) {
  if (left == null && right == null) return true;
  return left === right;
}

function truthy(value) {
  return Boolean(value);
}

function readPath(context, segments) {
  let current = context;
  for (const segment of segments) {
    if (DANGEROUS_KEYS.has(segment) || current == null) return undefined;
    if (segment === 'length' && (typeof current === 'string' || Array.isArray(current))) {
      current = current.length;
      continue;
    }
    if (Object(current) !== current) return undefined;
    current = current[segment];
  }
  return current;
}

function tokenize(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '\'' || char === '"') {
      const { value, end } = readString(source, index);
      tokens.push({ type: 'string', value, position: index });
      index = end;
      continue;
    }
    const numberMatch = source.slice(index).match(/^(?:\d+(?:\.\d+)?|\.\d+)/);
    if (numberMatch) {
      tokens.push({ type: 'number', value: Number(numberMatch[0]), position: index });
      index += numberMatch[0].length;
      continue;
    }
    const identMatch = source.slice(index).match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (identMatch) {
      tokens.push({ type: 'ident', value: identMatch[0], position: index });
      index += identMatch[0].length;
      continue;
    }
    const three = source.slice(index, index + 3);
    if (three === '===' || three === '!==') {
      tokens.push({ type: 'operator', value: three, position: index });
      index += 3;
      continue;
    }
    const two = source.slice(index, index + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
      tokens.push({ type: 'operator', value: two, position: index });
      index += 2;
      continue;
    }
    if (['>', '<', '!', '(', ')', '.'].includes(char)) {
      tokens.push({ type: 'operator', value: char, position: index });
      index += 1;
      continue;
    }
    throw new ExpressionError(`表达式中存在无法识别的字符：${char}`, index);
  }
  tokens.push({ type: 'eof', position: source.length });
  return tokens;
}

function readString(source, start) {
  const quote = source[start];
  let value = '';
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') {
      const next = source[index + 1];
      if (!next) throw new ExpressionError('字符串转义不完整', index);
      const escapes = { n: '\n', r: '\r', t: '\t', '\\': '\\', '\'': '\'', '"': '"' };
      value += escapes[next] ?? next;
      index += 2;
      continue;
    }
    if (char === quote) return { value, end: index + 1 };
    value += char;
    index += 1;
  }
  throw new ExpressionError('字符串缺少结束引号', start);
}

class Parser {
  constructor(tokens, source) {
    this.tokens = tokens;
    this.index = 0;
    this.source = source;
  }

  parse() {
    const node = this.parseOr();
    if (this.peek().type !== 'eof') {
      throw new ExpressionError('表达式末尾存在多余内容', this.peek().position);
    }
    return node;
  }

  peek() {
    return this.tokens[this.index];
  }

  consume() {
    return this.tokens[this.index++];
  }

  matchOperator(value) {
    const token = this.peek();
    if (token.type === 'operator' && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  matchKeyword(value) {
    const token = this.peek();
    if (token.type === 'ident' && token.value.toLowerCase() === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  parseOr() {
    let node = this.parseAnd();
    while (this.matchKeyword('or') || this.matchOperator('||')) {
      node = { type: 'binary', operator: 'or', left: node, right: this.parseAnd() };
    }
    return node;
  }

  parseAnd() {
    let node = this.parseNot();
    while (this.matchKeyword('and') || this.matchOperator('&&')) {
      node = { type: 'binary', operator: 'and', left: node, right: this.parseNot() };
    }
    return node;
  }

  parseNot() {
    if (this.matchKeyword('not') || this.matchOperator('!')) {
      return { type: 'unary', operator: '!', argument: this.parseNot() };
    }
    return this.parseComparison();
  }

  parseComparison() {
    const left = this.parsePrimary();
    const token = this.peek();
    if (
      token.type === 'operator' &&
      ['==', '===', '!=', '!==', '>', '>=', '<', '<='].includes(token.value)
    ) {
      const operator = this.consume().value;
      return { type: 'binary', operator, left, right: this.parsePrimary() };
    }
    return left;
  }

  parsePrimary() {
    const token = this.peek();
    if (token.type === 'number') {
      this.consume();
      return { type: 'literal', value: token.value };
    }
    if (token.type === 'string') {
      this.consume();
      return { type: 'literal', value: token.value };
    }
    if (this.matchOperator('(')) {
      const node = this.parseOr();
      if (!this.matchOperator(')')) {
        throw new ExpressionError('表达式缺少右括号', this.peek().position);
      }
      return node;
    }
    if (token.type === 'ident') {
      const lower = token.value.toLowerCase();
      if (lower === 'true') {
        this.consume();
        return { type: 'literal', value: true };
      }
      if (lower === 'false') {
        this.consume();
        return { type: 'literal', value: false };
      }
      if (lower === 'null' || lower === 'undefined') {
        this.consume();
        return { type: 'literal', value: null };
      }
      const segments = [this.consume().value];
      while (this.matchOperator('.')) {
        const next = this.consume();
        if (next.type !== 'ident') {
          throw new ExpressionError('属性访问缺少属性名', next.position);
        }
        segments.push(next.value);
      }
      return { type: 'path', segments };
    }
    throw new ExpressionError('表达式不完整', token.position);
  }
}
