import { evaluateExpression, ExpressionError } from './expression.js';

const TAG_NAMES = ['if', 'choose', 'when', 'otherwise', 'foreach', 'set', 'where'];
const OPEN_TAG = /^<(if|choose|when|otherwise|foreach|set|where)\b([^>]*)>/i;
const CLOSE_TAG = /^<\/(if|choose|when|otherwise|foreach|set|where)\s*>/i;

export class TemplateError extends Error {
  constructor(message, code = 'TEMPLATE_ERROR', position = null) {
    super(message);
    this.name = 'TemplateError';
    this.code = code;
    this.position = position;
  }
}

export function compileTemplate(sql) {
  const tokens = tokenizeTemplate(String(sql ?? ''));
  const cursor = { index: 0 };
  const nodes = parseNodes(tokens, cursor, null);
  if (cursor.index < tokens.length) {
    const token = tokens[cursor.index];
    throw new TemplateError(`存在未闭合的标签：${token.name ? `</${token.name}>` : '文本'}`, 'TEMPLATE_UNCLOSED_TAG', token.position);
  }
  if (!nodes.length) throw new TemplateError('SQL 不能为空');
  return nodes;
}

export function containsRawExpression(sql) {
  return /\$\{[^}]+\}/.test(String(sql ?? ''));
}

export function renderTemplate(ast, context = {}, options = {}) {
  const renderer = new TemplateRenderer({
    dialect: options.dialect === 'oracle' ? 'oracle' : 'mysql',
    allowRawSql: Boolean(options.allowRawSql)
  });
  const sql = renderer.renderNodes(ast, context);
  return { sql, values: renderer.values };
}

class TemplateRenderer {
  constructor({ dialect, allowRawSql }) {
    this.dialect = dialect;
    this.allowRawSql = allowRawSql;
    this.values = [];
  }

  renderNodes(nodes, context) {
    let output = '';
    for (const node of nodes) {
      output += this.renderNode(node, context);
    }
    return output;
  }

  renderNode(node, context) {
    if (node.type === 'text') return this.renderText(node.value, context);
    if (node.type === 'if') {
      return evaluateTest(node.test, context, node.position) ? this.renderNodes(node.children, context) : '';
    }
    if (node.type === 'choose') {
      for (const when of node.whens) {
        if (evaluateTest(when.test, context, when.position)) {
          return this.renderNodes(when.children, context);
        }
      }
      return node.otherwise ? this.renderNodes(node.otherwise.children, context) : '';
    }
    if (node.type === 'foreach') {
      return this.renderForeach(node, context);
    }
    if (node.type === 'set') {
      const content = this.renderNodes(node.children, context).trim();
      if (!content) return '';
      const withoutTrailingComma = content.replace(/,\s*$/, '');
      return `SET ${withoutTrailingComma}`;
    }
    if (node.type === 'where') {
      let content = this.renderNodes(node.children, context).trim();
      if (!content) return '';
      content = content.replace(/^(and|or)\b\s*/i, '');
      return `WHERE ${content}`;
    }
    return '';
  }

  renderForeach(node, context) {
    let collection;
    try {
      collection = evaluateExpression(node.collection, context);
    } catch (error) {
      throw wrapExpressionError(error, node.position);
    }
    if (collection == null) return '';
    if (typeof collection === 'string') {
      collection = collection.split(',').map((item) => item.trim()).filter(Boolean);
    }
    if (!Array.isArray(collection)) {
      throw new TemplateError(`<foreach> 集合必须是数组：${node.collection}`, 'TEMPLATE_FOREACH_COLLECTION', node.position);
    }
    const items = [];
    collection.forEach((item, index) => {
      const itemContext = {
        ...context,
        [node.item]: item,
        [`${node.item}Status`]: {
          index,
          first: index === 0,
          last: index === collection.length - 1
        }
      };
      items.push(this.renderNodes(node.children, itemContext));
    });
    if (!items.length) return '';
    return `${node.open}${items.join(node.separator)}${node.close}`;
  }

  renderText(text, context) {
    const pattern = /#\{([^}]*)\}|\$\{([^}]*)\}/g;
    let output = '';
    let lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      output += text.slice(lastIndex, match.index);
      const safeExpression = match[1];
      const rawExpression = match[2];
      if (safeExpression !== undefined) {
        const value = evaluatePlaceholder(safeExpression, context, match.index);
        output += this.addBind(value);
      } else {
        if (!this.allowRawSql) {
          throw new TemplateError(
            '检测到 ${} 原样拼接，请为该接口开启“允许原样 SQL”后再保存',
            'RAW_SQL_DISABLED',
            match.index
          );
        }
        const value = evaluatePlaceholder(rawExpression, context, match.index);
        if (value == null) continue;
        output += String(value);
      }
      lastIndex = match.index + match[0].length;
    }
    output += text.slice(lastIndex);
    return output;
  }

  addBind(value) {
    if (Array.isArray(value) || (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value))) {
      throw new TemplateError('绑定参数必须是字符串、数字、布尔值、日期或 Buffer', 'TEMPLATE_BIND_TYPE');
    }
    const normalized = value === undefined || Number.isNaN(value) ? null : value;
    this.values.push(normalized);
    const index = this.values.length - 1;
    return this.dialect === 'oracle' ? `:p${index}` : '?';
  }
}

function evaluatePlaceholder(expression, context, position) {
  try {
    return evaluateExpression(expression, context);
  } catch (error) {
    throw wrapExpressionError(error, position);
  }
}

function evaluateTest(expression, context, position) {
  try {
    return Boolean(evaluateExpression(expression, context));
  } catch (error) {
    throw wrapExpressionError(error, position);
  }
}

function wrapExpressionError(error, position) {
  if (error instanceof TemplateError) return error;
  const message = error instanceof ExpressionError ? error.message : String(error);
  return new TemplateError(`表达式错误：${message}`, 'TEMPLATE_EXPRESSION', position);
}

function tokenizeTemplate(sql) {
  const tokens = [];
  let index = 0;
  let textStart = 0;

  const pushText = (end) => {
    if (end > textStart) {
      tokens.push({ type: 'text', value: sql.slice(textStart, end), position: textStart });
    }
  };

  while (index < sql.length) {
    if (sql.startsWith('<!--', index)) {
      pushText(index);
      const end = sql.indexOf('-->', index + 4);
      if (end < 0) throw new TemplateError('SQL 注释未闭合', 'TEMPLATE_COMMENT', index);
      index = end + 3;
      textStart = index;
      continue;
    }
    if (sql[index] === '<') {
      const open = sql.slice(index).match(OPEN_TAG);
      if (open) {
        pushText(index);
        const name = open[1].toLowerCase();
        const attrs = parseAttributes(open[2], index);
        tokens.push({ type: 'open', name, attrs, position: index });
        index += open[0].length;
        textStart = index;
        continue;
      }
      const close = sql.slice(index).match(CLOSE_TAG);
      if (close) {
        pushText(index);
        tokens.push({ type: 'close', name: close[1].toLowerCase(), position: index });
        index += close[0].length;
        textStart = index;
        continue;
      }
    }
    index += 1;
  }
  pushText(sql.length);
  return tokens;
}

function parseAttributes(raw, position) {
  const attrs = {};
  const pattern = /([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of raw.matchAll(pattern)) {
    attrs[match[1]] = match[2] !== undefined ? match[2] : match[3];
  }
  return attrs;
}

function parseNodes(tokens, cursor, stopTag) {
  const nodes = [];
  while (cursor.index < tokens.length) {
    const token = tokens[cursor.index];
    if (token.type === 'text') {
      cursor.index += 1;
      nodes.push(token);
      continue;
    }
    if (token.type === 'close') {
      if (stopTag && token.name === stopTag) {
        cursor.index += 1;
        return nodes;
      }
      throw new TemplateError(`意外的结束标签：</${token.name}>`, 'TEMPLATE_UNEXPECTED_CLOSE', token.position);
    }

    if (token.name === 'if') {
      if (!token.attrs.test) throw new TemplateError('<if> 缺少 test 属性', 'TEMPLATE_IF_TEST', token.position);
      cursor.index += 1;
      nodes.push({
        type: 'if',
        test: token.attrs.test,
        position: token.position,
        children: parseNodes(tokens, cursor, 'if')
      });
      continue;
    }
    if (token.name === 'choose') {
      nodes.push(parseChoose(tokens, cursor, token));
      continue;
    }
    if (token.name === 'foreach') {
      if (!token.attrs.collection) {
        throw new TemplateError('<foreach> 缺少 collection 属性', 'TEMPLATE_FOREACH_COLLECTION', token.position);
      }
      cursor.index += 1;
      nodes.push({
        type: 'foreach',
        collection: token.attrs.collection,
        item: token.attrs.item || 'item',
        separator: token.attrs.separator || '',
        open: token.attrs.open || '',
        close: token.attrs.close || '',
        position: token.position,
        children: parseNodes(tokens, cursor, 'foreach')
      });
      continue;
    }
    if (token.name === 'set' || token.name === 'where') {
      cursor.index += 1;
      nodes.push({
        type: token.name,
        position: token.position,
        children: parseNodes(tokens, cursor, token.name)
      });
      continue;
    }
    if (token.name === 'when' || token.name === 'otherwise') {
      throw new TemplateError(`<${token.name}> 只能出现在 <choose> 中`, 'TEMPLATE_CHOOSE_CHILD', token.position);
    }
  }
  if (stopTag) {
    throw new TemplateError(`标签 <${stopTag}> 未闭合`, 'TEMPLATE_UNCLOSED_TAG');
  }
  return nodes;
}

function parseChoose(tokens, cursor, openToken) {
  cursor.index += 1;
  const whens = [];
  let otherwise = null;
  while (cursor.index < tokens.length) {
    const token = tokens[cursor.index];
    if (token.type === 'close' && token.name === 'choose') {
      cursor.index += 1;
      return { type: 'choose', whens, otherwise, position: openToken.position };
    }
    if (token.type === 'text' && !token.value.trim()) {
      cursor.index += 1;
      continue;
    }
    if (token.type === 'open' && token.name === 'when') {
      if (!token.attrs.test) throw new TemplateError('<when> 缺少 test 属性', 'TEMPLATE_WHEN_TEST', token.position);
      cursor.index += 1;
      whens.push({
        test: token.attrs.test,
        position: token.position,
        children: parseNodes(tokens, cursor, 'when')
      });
      continue;
    }
    if (token.type === 'open' && token.name === 'otherwise') {
      cursor.index += 1;
      otherwise = { children: parseNodes(tokens, cursor, 'otherwise'), position: token.position };
      continue;
    }
    throw new TemplateError('<choose> 中只能包含 <when> 或 <otherwise>', 'TEMPLATE_CHOOSE_INVALID', token.position);
  }
  throw new TemplateError('<choose> 未闭合', 'TEMPLATE_UNCLOSED_TAG', openToken.position);
}
