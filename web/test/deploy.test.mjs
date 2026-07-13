import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVses2, extractCookieValue, prepareWorkerSourceCode } from '../../lib/deploy.mjs';

test('normalizeVses2: 裸值补前缀', () => {
  assert.equal(normalizeVses2('cfes-123'), 'vses2=cfes-123;');
});

test('normalizeVses2: 已是完整 cookie 原样返回', () => {
  assert.equal(normalizeVses2('vses2=cfes-123;'), 'vses2=cfes-123;');
});

test('normalizeVses2: 空/空白返回空串', () => {
  assert.equal(normalizeVses2(''), '');
  assert.equal(normalizeVses2('   '), '');
});

test('extractCookieValue: 普通取值', () => {
  assert.equal(extractCookieValue('vses2=xyz; cf_clearance=123', 'vses2'), 'xyz');
  assert.equal(extractCookieValue('a=1; b=2', 'b'), '2');
});

test('extractCookieValue: 缺失返回空串', () => {
  assert.equal(extractCookieValue('x=1', 'missing'), '');
});

test('prepareWorkerSourceCode: 替换 uuid 占位', () => {
  const src = `// 顶部注释
const uuid = '80221445-old';
export default { hello: 1 };
`;
  const out = prepareWorkerSourceCode(src, 'NEW-UUID');
  assert.ok(out.includes("const uuid = 'NEW-UUID';"));
  assert.ok(!out.includes('80221445-old'));
});

test('prepareWorkerSourceCode: 剥离含敏感词的注释行', () => {
  const src = `const uuid = 'x';
// 这是 vless 密码 警告：别用
const a = 1;
`;
  const out = prepareWorkerSourceCode(src, 'x');
  assert.ok(!/密码|警告/.test(out));
  assert.ok(out.includes('const a = 1;'));
});
