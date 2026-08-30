'use strict';

const SCALE = 0x10000;
const MIN_Q16 = -0x80000000;
const MAX_Q16 = 0x7fffffff;

const EXPR_OP = Object.freeze({
  END: 0x00,
  CONST: 0x01,
  RANK: 0x02,
  RAND: 0x03,
  PARAM1: 0x11,
  ADD: 0x20,
  SUB: 0x21,
  MUL: 0x22,
  DIV: 0x23,
  NEG: 0x24,
});

class ExpressionError extends Error {
  constructor(message, index = 0) {
    super(message);
    this.name = 'ExpressionError';
    this.index = index;
  }
}

function tokenize(source) {
  const text = String(source ?? '').trim();
  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (/[()+\-*/%]/.test(char)) {
      tokens.push({ type: char, value: char, index });
      index += 1;
      continue;
    }
    if (char === '$') {
      const match = text.slice(index).match(/^\$(?:rank|rand|[1-4])/);
      if (!match) throw new ExpressionError('対応していない変数です。$rank、$rand、$1..$4だけを使用できます', index);
      tokens.push({ type: 'variable', value: match[0], index });
      index += match[0].length;
      continue;
    }
    const number = text.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) throw new ExpressionError('有限の数値が必要です', index);
      tokens.push({ type: 'number', value, raw: number[0], index });
      index += number[0].length;
      continue;
    }
    throw new ExpressionError(`式に使用できない文字です: ${char}`, index);
  }
  tokens.push({ type: 'eof', value: '', index: text.length });
  return { text, tokens };
}

function parseExpression(source) {
  if (source && typeof source === 'object' && source.type) return analyze(source);
  const { text, tokens } = tokenize(source === '' || source == null ? '0' : source);
  let cursor = 0;
  const peek = () => tokens[cursor];
  const consume = (type) => {
    const token = peek();
    if (token.type !== type) throw new ExpressionError(`${type} が必要です`, token.index);
    cursor += 1;
    return token;
  };
  function primary() {
    const token = peek();
    if (token.type === 'number') { cursor += 1; return { type: 'number', value: token.value }; }
    if (token.type === 'variable') { cursor += 1; return { type: 'variable', name: token.value }; }
    if (token.type === '(') {
      cursor += 1;
      const value = additive();
      consume(')');
      return value;
    }
    throw new ExpressionError('数値、変数、または括弧が必要です', token.index);
  }
  function unary() {
    if (peek().type === '+') { cursor += 1; return unary(); }
    if (peek().type === '-') { const token = tokens[cursor++]; return { type: 'unary', op: '-', value: unary(), index: token.index }; }
    return primary();
  }
  function multiplicative() {
    let left = unary();
    while (['*', '/', '%'].includes(peek().type)) {
      const token = tokens[cursor++];
      left = { type: 'binary', op: token.type, left, right: unary(), index: token.index };
    }
    return left;
  }
  function additive() {
    let left = multiplicative();
    while (['+', '-'].includes(peek().type)) {
      const token = tokens[cursor++];
      left = { type: 'binary', op: token.type, left, right: multiplicative(), index: token.index };
    }
    return left;
  }
  const ast = additive();
  if (peek().type !== 'eof') throw new ExpressionError('式の末尾に解釈できない内容があります', peek().index);
  const result = analyze(ast);
  result.source = text;
  return result;
}

function analyze(ast) {
  function visit(node) {
    if (!node || typeof node !== 'object') throw new ExpressionError('式ASTが不正です');
    if (node.type === 'number') {
      if (!Number.isFinite(node.value)) throw new ExpressionError('有限の数値が必要です');
      return { ast: { type: 'number', value: Number(node.value) }, dynamic: false, constant: Number(node.value), randCount: 0 };
    }
    if (node.type === 'variable') {
      if (!/^\$(?:rank|rand|[1-4])$/.test(node.name)) throw new ExpressionError(`対応していない変数です: ${node.name}`);
      return { ast: { type: 'variable', name: node.name }, dynamic: true, constant: null, randCount: node.name === '$rand' ? 1 : 0 };
    }
    if (node.type === 'unary' && node.op === '-') {
      const value = visit(node.value);
      if (!value.dynamic) return { ast: { type: 'number', value: -value.constant }, dynamic: false, constant: -value.constant, randCount: value.randCount };
      return { ast: { type: 'unary', op: '-', value: value.ast }, dynamic: true, constant: null, randCount: value.randCount };
    }
    if (node.type !== 'binary' || !['+', '-', '*', '/', '%'].includes(node.op)) throw new ExpressionError('対応していない式ASTです');
    const left = visit(node.left);
    const right = visit(node.right);
    if (node.op === '%') throw new ExpressionError('動的除数・剰余はv1 subsetで使用できません', node.index || 0);
    if (node.op === '*' && left.dynamic && right.dynamic) throw new ExpressionError('動的な値同士の乗算はv1 affine subsetで使用できません', node.index || 0);
    if (node.op === '/' && right.dynamic) throw new ExpressionError('動的除数はv1 affine subsetで使用できません', node.index || 0);
    if (node.op === '/' && right.constant === 0) throw new ExpressionError('0で除算できません', node.index || 0);
    const randCount = left.randCount + right.randCount;
    if (!left.dynamic && !right.dynamic) {
      const constants = { '+': left.constant + right.constant, '-': left.constant - right.constant, '*': left.constant * right.constant, '/': left.constant / right.constant };
      const value = constants[node.op];
      if (!Number.isFinite(value)) throw new ExpressionError('式の結果が有限値ではありません', node.index || 0);
      return { ast: { type: 'number', value }, dynamic: false, constant: value, randCount };
    }
    return { ast: { type: 'binary', op: node.op, left: left.ast, right: right.ast }, dynamic: true, constant: null, randCount };
  }
  const value = visit(ast.ast || ast);
  return { ...value, text: formatExpression(value.ast) };
}

function precedence(node) {
  if (node.type === 'binary') return ['+', '-'].includes(node.op) ? 1 : 2;
  if (node.type === 'unary') return 3;
  return 4;
}

function formatExpression(ast, parentPrecedence = 0, right = false) {
  if (ast.type === 'number') {
    if (Object.is(ast.value, -0)) return '0';
    return Number(ast.value).toString();
  }
  if (ast.type === 'variable') return ast.name;
  if (ast.type === 'unary') {
    const value = `-${formatExpression(ast.value, 3)}`;
    return parentPrecedence > 3 ? `(${value})` : value;
  }
  const own = precedence(ast);
  const left = formatExpression(ast.left, own, false);
  const rightText = formatExpression(ast.right, own + ((ast.op === '-' || ast.op === '/') ? 1 : 0), true);
  const value = `${left}${ast.op}${rightText}`;
  return own < parentPrecedence || (right && own === parentPrecedence && (ast.op === '-' || ast.op === '/')) ? `(${value})` : value;
}

function toQ16(value) {
  const scaled = Math.trunc(Number(value) * SCALE);
  if (!Number.isFinite(scaled) || scaled < MIN_Q16 || scaled > MAX_Q16) throw new ExpressionError(`Q16.16範囲外です: ${value}`);
  return scaled | 0;
}

function writeI32(value) {
  const result = Buffer.alloc(4);
  result.writeInt32BE(value | 0, 0);
  return result;
}

function compileExpression(expression) {
  const parsed = parseExpression(expression);
  const chunks = [];
  function emit(node) {
    if (node.type === 'number') { chunks.push(Buffer.from([EXPR_OP.CONST]), writeI32(toQ16(node.value))); return; }
    if (node.type === 'variable') {
      if (node.name === '$rank') chunks.push(Buffer.from([EXPR_OP.RANK]));
      else if (node.name === '$rand') chunks.push(Buffer.from([EXPR_OP.RAND]));
      else chunks.push(Buffer.from([EXPR_OP.PARAM1 + Number(node.name.slice(1)) - 1]));
      return;
    }
    if (node.type === 'unary') { emit(node.value); chunks.push(Buffer.from([EXPR_OP.NEG])); return; }
    emit(node.left);
    emit(node.right);
    chunks.push(Buffer.from([{ '+': EXPR_OP.ADD, '-': EXPR_OP.SUB, '*': EXPR_OP.MUL, '/': EXPR_OP.DIV }[node.op]]));
  }
  emit(parsed.ast);
  chunks.push(Buffer.from([EXPR_OP.END]));
  const bytes = Buffer.concat(chunks);
  if (bytes.length > 255) throw new ExpressionError('式bytecodeが255 byteを超えています');
  return { ...parsed, bytes };
}

function normalizeSeed(seed) {
  const value = Number(seed) & 0xffff;
  return value === 0 ? 0xace1 : value;
}

function nextRandom(seed) {
  let value = normalizeSeed(seed);
  value ^= (value << 7) & 0xffff;
  value ^= value >>> 9;
  value ^= (value << 8) & 0xffff;
  return value & 0xffff;
}

function qMul(left, right) {
  return Number((BigInt(left) * BigInt(right)) / BigInt(SCALE)) | 0;
}

function qDiv(left, right) {
  if (!right) throw new ExpressionError('0で除算できません');
  return Number((BigInt(left) * BigInt(SCALE)) / BigInt(right)) | 0;
}

function evaluateExpression(expression, context = {}) {
  const parsed = parseExpression(expression);
  let seed = normalizeSeed(context.seed);
  const params = Array.from({ length: 4 }, (_, index) => toQ16(context.params?.[index] || 0));
  const rank = Math.max(0, Math.min(0xffff, Math.trunc(Number(context.rank || 0) * 0xffff)));
  function visit(node) {
    if (node.type === 'number') return toQ16(node.value);
    if (node.type === 'variable') {
      if (node.name === '$rank') return rank;
      if (node.name === '$rand') { seed = nextRandom(seed); return seed; }
      return params[Number(node.name.slice(1)) - 1] || 0;
    }
    if (node.type === 'unary') return -visit(node.value) | 0;
    const left = visit(node.left);
    const rightValue = visit(node.right);
    if (node.op === '+') return left + rightValue | 0;
    if (node.op === '-') return left - rightValue | 0;
    if (node.op === '*') return qMul(left, rightValue);
    return qDiv(left, rightValue);
  }
  const q16 = visit(parsed.ast);
  return { q16, value: q16 / SCALE, seed };
}

module.exports = {
  SCALE,
  EXPR_OP,
  ExpressionError,
  tokenize,
  parseExpression,
  analyze,
  formatExpression,
  compileExpression,
  evaluateExpression,
  toQ16,
  normalizeSeed,
  nextRandom,
};
