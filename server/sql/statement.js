const STATEMENT_KEYWORDS = new Set([
  'select',
  'insert',
  'update',
  'delete',
  'merge',
  'call',
  'execute',
  'begin',
  'declare',
  'create',
  'alter',
  'drop',
  'truncate',
  'grant',
  'revoke'
]);

export function isSelectSql(sql) {
  const statement = firstStatementKeyword(sql);
  if (statement === 'select' || statement === 'explain') return true;
  if (statement !== 'with') return false;
  return withMainStatement(sql) === 'select';
}

export function trimSql(sql) {
  return String(sql || '').trim().replace(/;\s*$/, '').trim();
}

function firstStatementKeyword(sql) {
  const tokens = scanTokens(sql);
  return tokens.find((token) => token.type === 'word')?.value || '';
}

function withMainStatement(sql) {
  const tokens = scanTokens(sql);
  let depth = 0;
  let sawWith = false;
  let sawCteBody = false;
  for (const token of tokens) {
    if (token.type === 'open') {
      depth += 1;
      continue;
    }
    if (token.type === 'close') {
      if (depth > 0) depth -= 1;
      if (depth === 0 && sawWith) sawCteBody = true;
      continue;
    }
    if (depth !== 0 || token.type !== 'word') continue;
    if (!sawWith) {
      if (token.value === 'with') sawWith = true;
      continue;
    }
    if (sawCteBody && STATEMENT_KEYWORDS.has(token.value)) return token.value;
  }
  return '';
}

function scanTokens(sql) {
  const tokens = [];
  const input = String(sql || '');
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '-' && input[index + 1] === '-') {
      index += 2;
      while (index < input.length && input[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && input[index + 1] === '*') {
      index += 2;
      while (index < input.length && !(input[index] === '*' && input[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      index = skipQuoted(input, index, char);
      continue;
    }
    if (char === '[') {
      index = skipQuoted(input, index, ']');
      continue;
    }
    if (char === '(') {
      tokens.push({ type: 'open', value: char });
      index += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ type: 'close', value: char });
      index += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      let end = index + 1;
      while (end < input.length && /[A-Za-z0-9_$#]/.test(input[end])) end += 1;
      tokens.push({ type: 'word', value: input.slice(index, end).toLowerCase() });
      index = end;
      continue;
    }
    index += 1;
  }
  return tokens;
}

function skipQuoted(input, start, closing) {
  let index = start + 1;
  while (index < input.length) {
    if (input[index] === closing) {
      if (closing !== ']' && input[index + 1] === closing) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return index;
}
