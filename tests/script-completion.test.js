import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectCompletionContext,
  extractLibraryMethods,
  getScriptCompletions
} from '../public/js/script-completion.js';

const libraryCode = `
/** 用户辅助函数 */
function innerHelper() {
  return { wrong: true };
}
return {
  /** 规范化名称 */
  normalize(value) {
    return String(value || '').trim();
  },
  async findUser(id, options = {}) {
    return { id, options };
  },
  label: (value) => value,
  active: true,
  innerHelper
};
`;

test('shared script methods are extracted from the top-level return object', () => {
  const methods = extractLibraryMethods(libraryCode);
  assert.deepEqual(methods.map((method) => method.name), [
    'normalize',
    'findUser',
    'label',
    'active',
    'innerHelper'
  ]);
  assert.equal(methods[0].signature, 'normalize(value)');
  assert.equal(methods[0].description, '规范化名称');
  assert.equal(methods[1].signature, 'async findUser(id, options = {})');
  assert.equal(methods[1].call, true);
  assert.equal(methods[2].signature, 'label(value)');
  assert.equal(methods[3].call, false);
});

test('method extraction ignores commas and braces inside strings and nested values', () => {
  const methods = extractLibraryMethods(`
return {
  format(value) {
    return \`\${value}, ready }}\`;
  },
  nested() {
    return { value: 'a,b', inner: { ok: true } };
  },
  final: function (value = { comma: true }) { return value; }
};
`);
  assert.deepEqual(methods.map((method) => method.name), ['format', 'nested', 'final']);
  assert.equal(methods[2].signature, 'final(value = { comma: true })');
});

test('library methods complete after ctx.libs and respect the typed prefix', () => {
  const source = 'ctx.libs.helper.n';
  const result = getScriptCompletions({
    source,
    caret: source.length,
    libraries: [{ name: 'helper', enabled: true, description: '用户辅助', code: libraryCode }]
  });
  assert.deepEqual(result.chain, ['ctx', 'libs', 'helper']);
  assert.equal(result.token, 'n');
  assert.deepEqual(result.options.map((item) => item.label), ['normalize']);
  assert.equal(result.options[0].detail, 'normalize(value)');
});

test('disabled libraries and unknown libraries do not produce completions', () => {
  const enabledSource = 'ctx.libs.';
  assert.equal(
    getScriptCompletions({
      source: enabledSource,
      caret: enabledSource.length,
      libraries: [{ name: 'helper', enabled: false, code: libraryCode }]
    }),
    null
  );
  const unknownSource = 'ctx.libs.missing.';
  assert.equal(
    getScriptCompletions({
      source: unknownSource,
      caret: unknownSource.length,
      libraries: [{ name: 'helper', enabled: true, code: libraryCode }]
    }),
    null
  );
});

test('endpoint parameters complete through ctx.params and params', () => {
  const params = [
    { name: 'id', in: 'path', type: 'number', required: true, description: '用户 id' },
    { name: 'keyword', in: 'query', type: 'string', required: false }
  ];
  const ctxSource = 'ctx.params.';
  const ctxResult = getScriptCompletions({ source: ctxSource, caret: ctxSource.length, params });
  assert.deepEqual(ctxResult.options.map((item) => item.label), ['id', 'keyword']);
  assert.equal(ctxResult.options[0].detail, 'path · number · 必填');

  const source = 'params.k';
  const result = getScriptCompletions({ source, caret: source.length, params });
  assert.deepEqual(result.options.map((item) => item.label), ['keyword']);
});

test('plugins complete names and actions through both ctx and global aliases', () => {
  const plugins = [{ name: 'pricing', actions: ['calculate', 'preview'] }];
  const nameSource = 'ctx.plugins.';
  const nameResult = getScriptCompletions({
    source: nameSource,
    caret: nameSource.length,
    plugins
  });
  assert.deepEqual(nameResult.options.map((item) => item.label), ['pricing']);

  const actionSource = 'plugins.pricing.c';
  const actionResult = getScriptCompletions({
    source: actionSource,
    caret: actionSource.length,
    plugins
  });
  assert.deepEqual(actionResult.options.map((item) => item.label), ['calculate']);
});

test('core context exposes database, request, endpoint and logger hints', () => {
  const dbSource = 'ctx.db.';
  const dbResult = getScriptCompletions({ source: dbSource, caret: dbSource.length });
  assert.deepEqual(dbResult.options.map((item) => item.label), [
    'query',
    'queryOne',
    'execute',
    'transaction'
  ]);

  const requestSource = 'ctx.request.';
  const requestResult = getScriptCompletions({ source: requestSource, caret: requestSource.length });
  assert.deepEqual(requestResult.options.map((item) => item.label), ['query', 'body', 'path', 'headers']);

  const endpointSource = 'ctx.endpoint.';
  const endpointResult = getScriptCompletions({ source: endpointSource, caret: endpointSource.length });
  assert.deepEqual(endpointResult.options.map((item) => item.label), ['id', 'name', 'allowHttp']);
});

test('completion context is suppressed inside strings and comments', () => {
  const stringSource = "const value = 'ctx.libs.helper.";
  assert.equal(detectCompletionContext(stringSource, stringSource.length), null);
  const blockComment = '/* ctx.libs.helper.';
  assert.equal(detectCompletionContext(blockComment, blockComment.length), null);
  const lineComment = '// ctx.libs.helper.';
  assert.equal(detectCompletionContext(lineComment, lineComment.length), null);
});

test('manual completion opens root candidates and automatic completion needs a useful prefix', () => {
  assert.equal(getScriptCompletions({ source: '', caret: 0 }), null);
  const manual = getScriptCompletions({ source: '', caret: 0, manual: true });
  assert.ok(manual.options.some((item) => item.label === 'ctx'));
  assert.ok(manual.options.some((item) => item.label === 'return'));

  const prefixed = getScriptCompletions({ source: 'ct', caret: 2 });
  assert.deepEqual(prefixed.options.map((item) => item.label), ['ctx']);
});
