const TRANSACTION_SNIPPET = 'db.transaction(async (tx) => {\n  \n})';
const TRANSACTION_CARET = TRANSACTION_SNIPPET.indexOf('\n') + 3;
const QUERY_ONE_SNIPPET = "db.queryOne('SELECT ...', {  })";
const QUERY_ONE_CARET = QUERY_ONE_SNIPPET.indexOf('{  }') + 2;
const FETCH_SNIPPET = "http.fetch('https://api.example.com/path');";

function completion(label, detail, description, kind = 'property', extra = {}) {
  return {
    label,
    insertText: label,
    detail,
    description,
    kind,
    call: false,
    ...extra
  };
}

const ROOT_OPTIONS = [
  completion('ctx', 'context', '当前脚本的完整受控上下文', 'object'),
  completion('params', 'object', 'ctx.params 的快捷别名，当前请求参数', 'object'),
  completion('db', 'database', '执行查询、写入和事务', 'object'),
  completion('http', 'http', '受接口开关和白名单限制的外部 HTTP', 'object'),
  completion('plugins', 'plugins', '调用 PLUGINS_DIR 中加载的服务端插件', 'object'),
  completion('libs', 'shared scripts', '已启用的共享脚本对象', 'object'),
  completion('logger', 'logger', '写入脚本日志，最多保留 100 条', 'object'),
  completion('console', 'logger', 'logger 的快捷别名', 'object')
];

const JS_KEYWORD_OPTIONS = [
  completion('return', 'keyword', '返回可 JSON 序列化的数据', 'keyword'),
  completion('await', 'keyword', '等待异步调用完成', 'keyword'),
  completion('const', 'keyword', '声明常量', 'keyword'),
  completion('let', 'keyword', '声明变量', 'keyword'),
  completion('async', 'keyword', '声明异步函数', 'keyword'),
  completion('if', 'keyword', '条件分支', 'keyword'),
  completion('else', 'keyword', '条件分支', 'keyword'),
  completion('try', 'keyword', '异常捕获结构', 'keyword'),
  completion('catch', 'keyword', '捕获脚本异常', 'keyword'),
  completion('throw', 'keyword', '抛出脚本错误', 'keyword')
];

const CTX_OPTIONS = [
  completion('params', 'object', '按接口参数声明解析、校验和类型转换后的参数', 'object'),
  completion('request', 'object', '已移除敏感请求头的 query、body、path、headers', 'object'),
  completion('endpoint', 'object', '当前脚本接口的 id、name 和 allowHttp', 'object'),
  completion('db', 'database', '执行查询、写入和事务', 'object'),
  completion('http', 'http', '受接口开关和白名单限制的外部 HTTP', 'object'),
  completion('plugins', 'plugins', '调用已加载的服务端插件', 'object'),
  completion('libs', 'shared scripts', '已启用的共享脚本对象', 'object'),
  completion('logger', 'logger', '写入脚本日志', 'object'),
  completion('console', 'logger', 'logger 的快捷别名', 'object')
];

const REQUEST_OPTIONS = [
  completion('query', 'object', 'URL 查询参数', 'object'),
  completion('body', 'object', '请求体', 'object'),
  completion('path', 'object', '路径参数', 'object'),
  completion('headers', 'object', '已移除鉴权、Cookie 等敏感头', 'object')
];

const ENDPOINT_OPTIONS = [
  completion('id', 'string', '接口 id', 'property'),
  completion('name', 'string', '接口名称', 'property'),
  completion('allowHttp', 'boolean', '接口是否开启外部 HTTP', 'property')
];

const DB_OPTIONS = [
  completion('query', '(sql, params = {})', '执行查询并返回 rows', 'method', { call: true }),
  completion('queryOne', '(sql, params = {})', '执行查询并返回第一行，或返回 null', 'method', { call: true }),
  completion('execute', '(sql, params = {})', '执行写入并返回 affectedRows、insertId', 'method', { call: true }),
  completion('transaction', '(async (tx) => {})', '开启事务；异常时自动回滚', 'method', {
    call: true,
    insertText: TRANSACTION_SNIPPET,
    cursorOffset: TRANSACTION_CARET
  })
];

const TX_OPTIONS = [
  completion('query', '(sql, params = {})', '事务内查询，返回 rows', 'method', { call: true }),
  completion('queryOne', '(sql, params = {})', '事务内查询并返回第一行', 'method', { call: true }),
  completion('execute', '(sql, params = {})', '事务内写入，返回 affectedRows、insertId', 'method', { call: true })
];

const HTTP_OPTIONS = [
  completion('fetch', '(url, options = {})', '请求外部 HTTP；需接口开关和白名单命中', 'method', { call: true })
];

const LOGGER_OPTIONS = [
  completion('debug', '(...args)', '写入 debug 日志', 'method', { call: true }),
  completion('info', '(...args)', '写入 info 日志', 'method', { call: true }),
  completion('warn', '(...args)', '写入 warn 日志', 'method', { call: true }),
  completion('error', '(...args)', '写入 error 日志', 'method', { call: true })
];

export const SCRIPT_API_QUICK_REFERENCE = [
  { label: 'ctx.params.', snippet: 'ctx.params.', description: '参数补全' },
  { label: 'db.', snippet: 'db.', description: '数据库方法' },
  { label: 'db.queryOne', snippet: QUERY_ONE_SNIPPET, caretOffset: QUERY_ONE_CARET, description: '查询单行' },
  { label: 'db.transaction', snippet: TRANSACTION_SNIPPET, caretOffset: TRANSACTION_CARET, description: '事务' },
  { label: 'http.fetch', snippet: FETCH_SNIPPET, description: '外部请求' },
  { label: 'ctx.plugins.', snippet: 'ctx.plugins.', description: '插件方法' },
  { label: 'ctx.libs.', snippet: 'ctx.libs.', description: '共享脚本' },
  { label: 'ctx.logger.', snippet: 'ctx.logger.', description: '脚本日志' }
];

export function getScriptCompletions({
  source = '',
  caret = 0,
  params = [],
  libraries = [],
  plugins = [],
  manual = false
} = {}) {
  const context = detectCompletionContext(source, caret);
  if (!context) return null;
  const candidates = candidatesForChain(context.chain, { params, libraries, plugins });
  const token = context.token;
  const options = candidates
    .filter((item) => item.label.toLowerCase().startsWith(token.toLowerCase()))
    .slice(0, 12);
  if (!manual && !context.chain.length && token.length < 2) return null;
  if (!options.length) return null;
  if (!manual && options.length === 1 && options[0].label === token) return null;
  return { ...context, options };
}

export function detectCompletionContext(source, caret) {
  const text = String(source ?? '');
  const position = Math.max(0, Math.min(Number(caret) || 0, text.length));
  if (isInsideStringOrComment(text, position)) return null;
  let from = position;
  while (from > 0 && /[A-Za-z0-9_$]/.test(text[from - 1])) from -= 1;
  const token = text.slice(from, position);
  const chain = parseChainBefore(text, from);
  return { chain, token, from, to: position };
}

export function extractLibraryMethods(code) {
  const text = String(code ?? '');
  const found = findTopLevelReturnObject(text);
  if (!found) return [];
  const close = findMatchingBrace(text, found);
  if (close < 0) return [];
  const methods = splitObjectMembers(text, found + 1, close)
    .map(parseObjectMember)
    .filter(Boolean);
  const seen = new Set();
  return methods.filter((method) => {
    if (seen.has(method.name)) return false;
    seen.add(method.name);
    return true;
  });
}

function candidatesForChain(chain, { params, libraries, plugins }) {
  if (!chain.length) return [...ROOT_OPTIONS, ...JS_KEYWORD_OPTIONS];
  if (chain[0] === 'ctx') {
    if (chain.length === 1) return CTX_OPTIONS;
    if (chain[1] === 'params') return chain.length === 2 ? paramOptions(params) : [];
    if (chain[1] === 'request') return chain.length === 2 ? REQUEST_OPTIONS : [];
    if (chain[1] === 'endpoint') return chain.length === 2 ? ENDPOINT_OPTIONS : [];
    if (chain[1] === 'db') return chain.length === 2 ? DB_OPTIONS : [];
    if (chain[1] === 'http') return chain.length === 2 ? HTTP_OPTIONS : [];
    if (chain[1] === 'logger' || chain[1] === 'console') {
      return chain.length === 2 ? LOGGER_OPTIONS : [];
    }
    if (chain[1] === 'libs') return libraryCandidates(chain.slice(2), libraries);
    if (chain[1] === 'plugins') return pluginCandidates(chain.slice(2), plugins);
    return [];
  }
  if (chain[0] === 'params') return chain.length === 1 ? paramOptions(params) : [];
  if (chain[0] === 'db') return chain.length === 1 ? DB_OPTIONS : [];
  if (chain[0] === 'http') return chain.length === 1 ? HTTP_OPTIONS : [];
  if (chain[0] === 'tx') return chain.length === 1 ? TX_OPTIONS : [];
  if (chain[0] === 'logger' || chain[0] === 'console') {
    return chain.length === 1 ? LOGGER_OPTIONS : [];
  }
  if (chain[0] === 'libs') return libraryCandidates(chain.slice(1), libraries);
  if (chain[0] === 'plugins') return pluginCandidates(chain.slice(1), plugins);
  return [];
}

function paramOptions(params) {
  return (params || [])
    .filter((param) => param?.name)
    .map((param) => {
      const required = param.required ? ' · 必填' : '';
      return completion(
        String(param.name),
        `${param.in || 'query'} · ${param.type || 'string'}${required}`,
        param.description || '当前接口声明的请求参数',
        'parameter'
      );
    });
}

function libraryCandidates(chain, libraries) {
  const enabled = (libraries || []).filter((library) => library?.enabled !== false && library?.name);
  if (!chain.length) {
    return enabled.map((library) =>
      completion(library.name, 'shared script', library.description || '已启用的共享脚本', 'library')
    );
  }
  if (chain.length !== 1) return [];
  const library = enabled.find((item) => item.name === chain[0]);
  if (!library) return [];
  return extractLibraryMethods(library.code).map((method) =>
    completion(
      method.name,
      method.signature,
      method.description || `共享脚本 ${library.name} 的方法`,
      'method',
      { call: method.call !== false }
    )
  );
}

function pluginCandidates(chain, plugins) {
  const available = (plugins || []).filter((plugin) => plugin?.name);
  if (!chain.length) {
    return available.map((plugin) =>
      completion(
        plugin.name,
        `${plugin.actions?.length || 0} actions`,
        '已加载的服务端插件',
        'plugin'
      )
    );
  }
  if (chain.length !== 1) return [];
  const plugin = available.find((item) => item.name === chain[0]);
  if (!plugin) return [];
  return (plugin.actions || []).map((action) =>
    completion(action, '(...args)', `调用插件 ${plugin.name}.${action}`, 'method', { call: true })
  );
}

function parseChainBefore(source, from) {
  const chain = [];
  let cursor = from;
  while (cursor > 0) {
    let index = cursor - 1;
    while (index >= 0 && /\s/.test(source[index])) index -= 1;
    if (source[index] !== '.') break;
    if (source[index - 1] === '?') index -= 1;
    index -= 1;
    while (index >= 0 && /\s/.test(source[index])) index -= 1;
    if (index < 0 || !/[A-Za-z0-9_$]/.test(source[index])) break;
    let start = index;
    while (start >= 0 && /[A-Za-z0-9_$]/.test(source[start])) start -= 1;
    const segment = source.slice(start + 1, index + 1);
    if (!segment || !/[A-Za-z_$]/.test(segment[0])) break;
    chain.unshift(segment);
    cursor = start + 1;
  }
  return chain;
}

function isInsideStringOrComment(source, caret) {
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < caret; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
  }
  return Boolean(quote || lineComment || blockComment);
}

function findTopLevelReturnObject(source) {
  let depth = 0;
  let candidate = -1;
  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipLiteralOrComment(source, index);
    if (skipped > index) {
      index = skipped - 1;
      continue;
    }
    const char = source[index];
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0 || !isWordAt(source, index, 'return')) continue;
    let open = skipTrivia(source, index + 6);
    if (source[open] === '(') open = skipTrivia(source, open + 1);
    if (source[open] === '{') candidate = open;
  }
  return candidate;
}

function findMatchingBrace(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const skipped = skipLiteralOrComment(source, index);
    if (skipped > index) {
      index = skipped - 1;
      continue;
    }
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitObjectMembers(source, start, end) {
  const members = [];
  let segmentStart = start;
  let parens = 0;
  let brackets = 0;
  let braces = 0;
  for (let index = start; index < end; index += 1) {
    const skipped = skipLiteralOrComment(source, index);
    if (skipped > index) {
      index = skipped - 1;
      continue;
    }
    const char = source[index];
    if (char === '(') parens += 1;
    else if (char === ')') parens = Math.max(0, parens - 1);
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets = Math.max(0, brackets - 1);
    else if (char === '{') braces += 1;
    else if (char === '}') braces = Math.max(0, braces - 1);
    else if (char === ',' && parens === 0 && brackets === 0 && braces === 0) {
      const member = source.slice(segmentStart, index).trim();
      if (member) members.push(member);
      segmentStart = index + 1;
    }
  }
  const tail = source.slice(segmentStart, end).trim();
  if (tail) members.push(tail);
  return members;
}

function parseObjectMember(raw) {
  const { description, rest } = consumeLeadingComments(raw);
  let body = rest.trim();
  if (!body || body.startsWith('...')) return null;
  let isAsync = false;
  const asyncMatch = body.match(/^async\s+/);
  if (asyncMatch) {
    isAsync = true;
    body = body.slice(asyncMatch[0].length).trimStart();
  }
  const accessorMatch = body.match(/^(get|set)\s+(?=[A-Za-z_$])/);
  const accessor = accessorMatch ? accessorMatch[1] : '';
  if (accessorMatch) body = body.slice(accessorMatch[0].length).trimStart();

  let name = '';
  let keyEnd = 0;
  const first = body[0];
  if (first === '"' || first === "'") {
    const end = findStringEnd(body, 0);
    if (end < 0) return null;
    name = body.slice(1, end);
    keyEnd = end + 1;
  } else {
    const match = body.match(/^[A-Za-z_$][A-Za-z0-9_$]*/);
    if (!match) return null;
    name = match[0];
    keyEnd = name.length;
  }
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return null;

  const tail = body.slice(keyEnd).trimStart();
  if (tail.startsWith('(')) {
    const open = body.indexOf('(', keyEnd);
    const close = findMatchingParen(body, open);
    if (close < 0) return null;
    const parameters = normalizeParameters(body.slice(open + 1, close));
    return {
      name,
      signature: `${isAsync ? 'async ' : ''}${name}(${parameters})`,
      description,
      call: !accessor,
      async: isAsync
    };
  }
  if (tail.startsWith(':')) {
    const valueStart = body.indexOf(':', keyEnd) + 1;
    let value = body.slice(valueStart).trim();
    let valueAsync = false;
    const valueAsyncMatch = value.match(/^async\s+/);
    if (valueAsyncMatch) {
      valueAsync = true;
      value = value.slice(valueAsyncMatch[0].length).trimStart();
    }
    const callable = parseFunctionValue(value);
    return {
      name,
      signature: callable
        ? `${valueAsync ? 'async ' : ''}${name}(${callable})`
        : name,
      description,
      call: Boolean(callable),
      async: valueAsync
    };
  }
  return {
    name,
    signature: name,
    description,
    call: false,
    async: false
  };
}

function parseFunctionValue(value) {
  if (value.startsWith('function')) {
    const open = value.indexOf('(');
    if (open < 0) return '';
    const close = findMatchingParen(value, open);
    return close < 0 ? '' : normalizeParameters(value.slice(open + 1, close));
  }
  if (value.startsWith('(')) {
    const close = findMatchingParen(value, 0);
    return close < 0 ? '' : normalizeParameters(value.slice(1, close));
  }
  const single = value.match(/^[A-Za-z_$][A-Za-z0-9_$]*\s*=>/);
  if (single) return single[0].replace(/=>$/, '').trim();
  return '';
}

function findMatchingParen(source, open) {
  if (open < 0) return -1;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const skipped = skipLiteralOrComment(source, index);
    if (skipped > index) {
      index = skipped - 1;
      continue;
    }
    if (source[index] === '(') depth += 1;
    if (source[index] === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function normalizeParameters(parameters) {
  return String(parameters || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();
}

function consumeLeadingComments(raw) {
  let index = 0;
  let description = '';
  while (index < raw.length) {
    while (index < raw.length && /\s/.test(raw[index])) index += 1;
    if (raw.startsWith('//', index)) {
      const end = raw.indexOf('\n', index);
      const line = raw.slice(index + 2, end < 0 ? raw.length : end).trim();
      if (!description && line) description = line;
      index = end < 0 ? raw.length : end + 1;
      continue;
    }
    if (raw.startsWith('/*', index)) {
      const end = raw.indexOf('*/', index + 2);
      if (end < 0) break;
      const text = firstCommentLine(raw.slice(index + 2, end));
      if (!description && text) description = text;
      index = end + 2;
      continue;
    }
    break;
  }
  return { description, rest: raw.slice(index) };
}

function firstCommentLine(body) {
  const lines = body
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, '').trim())
    .filter(Boolean);
  return lines.find((line) => !line.startsWith('@')) || '';
}

function findStringEnd(source, open) {
  const quote = source[open];
  for (let index = open + 1; index < source.length; index += 1) {
    if (source[index] === '\\') {
      index += 1;
      continue;
    }
    if (source[index] === quote) return index;
  }
  return -1;
}

function skipLiteralOrComment(source, index) {
  const char = source[index];
  const next = source[index + 1];
  if (char === '/' && next === '/') {
    const end = source.indexOf('\n', index + 2);
    return end < 0 ? source.length : end;
  }
  if (char === '/' && next === '*') {
    const end = source.indexOf('*/', index + 2);
    return end < 0 ? source.length : end + 2;
  }
  if (char === '"' || char === "'" || char === '`') {
    const end = findStringEnd(source, index);
    return end < 0 ? source.length : end + 1;
  }
  return -1;
}

function skipTrivia(source, index) {
  let cursor = index;
  while (cursor < source.length) {
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    if (source.startsWith('//', cursor)) {
      const end = source.indexOf('\n', cursor + 2);
      cursor = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith('/*', cursor)) {
      const end = source.indexOf('*/', cursor + 2);
      cursor = end < 0 ? source.length : end + 2;
      continue;
    }
    break;
  }
  return cursor;
}

function isWordAt(source, index, word) {
  if (source.slice(index, index + word.length) !== word) return false;
  const before = source[index - 1];
  const after = source[index + word.length];
  return !(before && /[A-Za-z0-9_$]/.test(before)) && !(after && /[A-Za-z0-9_$]/.test(after));
}
