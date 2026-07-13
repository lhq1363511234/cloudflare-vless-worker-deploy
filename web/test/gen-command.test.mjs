import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeInstallerInput,
  buildInstaller,
  buildFscarmenCommand,
  extractVlessLink,
} from '../../lib/gen-command.mjs';

test('normalizeInstallerInput 默认值', () => {
  const r = normalizeInstallerInput({});
  assert.equal(r.protocol, 'vless-reality');
  assert.equal(r.port, 443);
  assert.equal(r.serverName, 'www.apple.com');
  assert.equal(r.flow, 'xtls-rprx-vision');
  assert.equal(r.uuid, '');
});

test('normalizeInstallerInput 非法端口回退 443', () => {
  assert.equal(normalizeInstallerInput({ port: '99999' }).port, 443);
  assert.equal(normalizeInstallerInput({ port: 'abc' }).port, 443);
});

test('normalizeInstallerInput 过滤非法 UUID', () => {
  assert.equal(normalizeInstallerInput({ uuid: 'not-a-uuid' }).uuid, '');
  assert.equal(
    normalizeInstallerInput({ uuid: '80221445-0000-0000-0000-000000000000' }).uuid,
    '80221445-0000-0000-0000-000000000000',
  );
});

test('buildInstaller reality 含关键字段', () => {
  const s = buildInstaller({ protocol: 'vless-reality', port: 443, serverName: 'www.apple.com' });
  assert.match(s, /xtls-rprx-vision/);
  assert.match(s, /reality/);
  assert.match(s, /vless:\/\/\$UUID@\$IP:\$PORT/);
  assert.match(s, /sing-box generate reality-keypair/);
});

test('buildInstaller trojan 生成 trojan:// 链接', () => {
  const s = buildInstaller({ protocol: 'trojan', serverName: 'v.example.com' });
  assert.match(s, /trojan:\/\/\$PASSWORD@\$SERVER_NAME/);
});

test('buildFscarmenCommand 返回 fscarmen 一键脚本', () => {
  assert.match(buildFscarmenCommand(), /fscarmen\/sing-box/);
});

test('extractVlessLink 抽取分享链接', () => {
  const log = 'some text\nvless://abc-123@1.2.3.4:443?security=reality#x\nend';
  assert.equal(
    extractVlessLink(log),
    'vless://abc-123@1.2.3.4:443?security=reality#x',
  );
  assert.equal(extractVlessLink('no link here'), null);
});
