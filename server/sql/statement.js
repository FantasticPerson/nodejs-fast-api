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
  const statement = queryStatementKeyword(scanTokens(sql));
  return statement === 'select' || statement === 'explain';
}

export function trimSql(sql) {
  return String(sql || '').trim().replace(/;\s*$/, '').trim();
}

function queryStatementKeyword(tokens) {
  const unwrapped = unwrapEnclosingParentheses(tokens);
  if (unwrapped[0]?.type === 'open') {
    const close = matchingClose(unwrapped, 0);
    if (close !== -1) return queryStatementKeyword(unwrapped.slice(1, close));
  }
  const statement = firstStatementKeyword(unwrapped);
  if (statement === 'select' || statement === 'explain') return statement;
  if (statement !== 'with') return statement;
  return withMainStatement(unwrapped);
}

function firstStatementKeyword(tokens) {
  return tokens.find((token) => token.type === 'word')?.value || '';
}

function withMainStatement(tokens) {
  let depth = 0;
  let sawWith = false;
  let cteBodyPending = false;
  let insideCteBody = false;
  let afterCteBody = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'open') {
      if (depth === 0 && sawWith && afterCteBody && !cteBodyPending) {
        const close = matchingClose(tokens, index);
        if (close !== -1) {
          return queryStatementKeyword(tokens.slice(index + 1, close));
        }
      }
      if (depth === 0 && cteBodyPending) {
        cteBodyPending = false;
        insideCteBody = true;
        afterCteBody = false;
      }
      depth += 1;
      continue;
    }
    if (token.type === 'close') {
      if (depth > 0) depth -= 1;
      if (depth === 0 && insideCteBody) {
        insideCteBody = false;
        afterCteBody = true;
      }
      continue;
    }
    if (token.type === 'comma') {
      if (depth === 0 && sawWith && afterCteBody) afterCteBody = false;
      continue;
    }
    if (depth !== 0 || token.type !== 'word') continue;
    if (!sawWith) {
      if (token.value === 'with') sawWith = true;
      continue;
    }
    if (token.value === 'as') {
      cteBodyPending = true;
      afterCteBody = false;
      continue;
    }
    if (afterCteBody && STATEMENT_KEYWORDS.has(token.value)) return token.value;
  }
  return '';
}

function unwrapEnclosingParentheses(tokens) {
  let start = 0;
  let end = tokens.length;
  while (start < end && tokens[start].type === 'open') {
    const close = matchingClose(tokens, start);
    if (close !== end - 1) break;
    start += 1;
    end -= 1;
  }
  return start === 0 && end === tokens.length ? tokens : tokens.slice(start, end);
}

function matchingClose(tokens, start) {
  if (start < 0 || start >= tokens.length || tokens[start].type !== 'open') return -1;
  let depth = 0;
  for (let cursor = start; cursor < tokens.length; cursor += 1) {
    if (tokens[cursor].type === 'open') depth += 1;
    if (tokens[cursor].type === 'close') {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
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
    if (char === ',') {
      tokens.push({ type: 'comma', value: char });
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
