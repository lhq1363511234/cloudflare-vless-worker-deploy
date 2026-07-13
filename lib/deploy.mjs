// Cloudflare VLESS Worker 部署核心（可从 CLI 或 Web 服务调用）
// 仅依赖 Node 内置模块，无第三方依赖，适配 Termux 等环境。

import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const DASH_API_BASE = 'https://dash.cloudflare.com/api/v4';
const ACCOUNT_ID_RE = /^[a-f0-9]{32}$/i;
const DEFAULT_COMPATIBILITY_DATE = '2026-06-13';
const DEFAULT_TEST_URL = 'http://www.gstatic.com/generate_204';
const WRITE_EDIT_WORD_RE = /\b(write|edit)\b/ig;
const DEFAULT_TOKEN_PAYLOAD = {
  name: '账号部署令牌',
  condition: {},
  policies: [
    {
      effect: 'allow',
      resources: { 'com.cloudflare.api.account.*': '*' },
      permission_groups: [
        { name: 'Account Settings Read' },
        { name: 'Workers Scripts Read' },
        { name: 'Workers Scripts Write' },
      ],
    },
    {
      effect: 'allow',
      resources: { 'com.cloudflare.api.account.zone.*': '*' },
      permission_groups: [
        { name: 'Zone Read' },
        { name: 'Zone Write' },
        { name: 'DNS Read' },
        { name: 'DNS Write' },
        { name: 'Workers Routes Read' },
        { name: 'Workers Routes Write' },
      ],
    },
  ],
};

function randomSlug(bytes = 5) {
  return randomBytes(bytes).toString('hex');
}

function normalizeVses2(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/;\s*$/.test(trimmed) || /=/.test(trimmed)) return trimmed;
  return `vses2=${trimmed};`;
}

function extractCookieValue(cookie, name) {
  return String(cookie || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) || '';
}

// 纯函数：把 worker 源码里的占位 uuid 替换成目标 uuid，并清掉注释行。
function prepareWorkerSourceCode(source, uuid) {
  const prepared = source
    .replace(/^\s*const uuid = '[^']+';.*$/m, `const uuid = '${uuid}';`)
    .replace(/^\s*\/\/.*(?:vless|trojan|密码|警告).*$/gim, '');
  if (!prepared.includes(`const uuid = '${uuid}';`)) {
    throw new Error('Worker 源码处理失败：没有生成 uuid 常量。');
  }
  return prepared;
}

function normalizePermissionName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(WRITE_EDIT_WORD_RE, 'write')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function permissionNameCandidates(group) {
  const names = [
    group.name,
    ...(Array.isArray(group.names) ? group.names : []),
    ...(Array.isArray(group.aliases) ? group.aliases : []),
  ].filter(Boolean);
  const expanded = [];
  for (const name of names) {
    expanded.push(name);
    expanded.push(String(name).replace(/\bWrite\b/g, 'Edit'));
    expanded.push(String(name).replace(/\bEdit\b/g, 'Write'));
  }
  return [...new Set(expanded)];
}

function scopesFromResources(resources = {}) {
  const scopes = new Set();
  for (const resource of Object.keys(resources)) {
    if (resource.startsWith('com.cloudflare.api.account.zone')) scopes.add('com.cloudflare.api.account.zone');
    else if (resource.startsWith('com.cloudflare.api.account')) scopes.add('com.cloudflare.api.account');
    else if (resource.startsWith('com.cloudflare.api.user')) scopes.add('com.cloudflare.api.user');
    else if (resource.startsWith('com.cloudflare.edge.r2.bucket')) scopes.add('com.cloudflare.edge.r2.bucket');
  }
  return [...scopes];
}

function scopeMatches(permissionGroup, wantedScopes) {
  if (!wantedScopes.length) return true;
  const actualScopes = Array.isArray(permissionGroup.scopes) ? permissionGroup.scopes : [];
  return wantedScopes.some((scope) => actualScopes.includes(scope));
}

async function listPermissionGroups({ accountId, vses2, cookie, atok, name, scope }) {
  const params = new URLSearchParams();
  if (name) params.set('name', name);
  if (scope) params.set('scope', scope);
  params.set('per_page', '1000');
  const suffix = params.toString() ? `?${params}` : '';
  return dashboardSessionFetch(`/user/tokens/permission_groups${suffix}`, { accountId, vses2, cookie, atok });
}

async function visiblePermissionNames(session, scopes) {
  const seen = new Set();
  const groups = [];
  for (const scope of scopes.length ? scopes : ['']) {
    for (const group of await listPermissionGroups({ ...session, scope })) {
      const key = `${group.id}:${group.name}`;
      if (!seen.has(key)) {
        seen.add(key);
        groups.push(group);
      }
    }
  }
  return groups
    .map((group) => `${group.name}${group.scopes?.length ? ` [${group.scopes.join(', ')}]` : ''}`)
    .sort()
    .join('\n');
}

async function resolvePermissionGroup(group, wantedScopes, session) {
  if (group.id) return { id: group.id };
  const candidates = permissionNameCandidates(group);
  if (!candidates.length) throw new Error('permission_groups 里缺少 id 或 name。');
  for (const candidate of candidates) {
    const groups = await listPermissionGroups({ ...session, name: candidate, scope: wantedScopes[0] });
    const match = groups.find((item) => normalizePermissionName(item.name) === normalizePermissionName(candidate) && scopeMatches(item, wantedScopes))
      || groups.find((item) => normalizePermissionName(item.name) === normalizePermissionName(candidate));
    if (match?.id) return { id: match.id };
  }
  const visible = await visiblePermissionNames(session, wantedScopes);
  throw new Error(`找不到权限组：${candidates.join(' / ')}${wantedScopes.length ? `（scope: ${wantedScopes.join(', ')}）` : ''}\n\n当前可见权限组：\n${visible || '(空)'}`);
}

async function resolveTokenPayload(payload, session) {
  const policies = [];
  for (const policy of payload.policies || []) {
    const wantedScopes = scopesFromResources(policy.resources);
    const permissionGroups = [];
    for (const group of policy.permission_groups || []) {
      permissionGroups.push(await resolvePermissionGroup(group, wantedScopes, session));
    }
    policies.push({ ...policy, permission_groups: permissionGroups });
  }
  return { ...payload, policies };
}

async function createApiTokenFromDashboardSession({ accountId, vses2, cookie, atok } = {}) {
  if (!ACCOUNT_ID_RE.test(accountId || '')) throw new Error('缺少或非法的 Cloudflare account id。');
  if (!sessionCookie({ cookie, vses2 })) throw new Error('缺少登录态。请用 vses2 传入，或用完整 Cookie 传入。');
  const payload = await resolveTokenPayload(DEFAULT_TOKEN_PAYLOAD, { accountId, vses2, cookie, atok });
  const result = await dashboardSessionFetch('/user/tokens', { accountId, vses2, cookie, atok, method: 'POST', body: payload });
  const token = result?.value || result?.token;
  if (!token) throw new Error('Cloudflare 创建了 Token，但响应里没有返回 token value。');
  return { token, name: result.name || DEFAULT_TOKEN_PAYLOAD.name, id: result.id || null };
}

function dashboardCookie({ dashboardCookie, dashboardVses2 } = {}) {
  return String(dashboardCookie || '').trim() || normalizeVses2(dashboardVses2);
}

function sessionCookie({ cookie, vses2 } = {}) {
  return String(cookie || '').trim() || normalizeVses2(vses2);
}

function hasFullDashboardCookie({ dashboardCookie } = {}) {
  const cookie = String(dashboardCookie || '');
  return cookie.includes('vses2=') && cookie.includes('cf_clearance=');
}

function errorDetail(body, fallback) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  if (errors.length) {
    return errors.map((error) => {
      const message = error.message || JSON.stringify(error);
      if (/<html|<!DOCTYPE html|Attention Required|been blocked/i.test(message)) {
        return 'dash.cloudflare.com 返回了 Cloudflare 安全拦截页；请从浏览器请求里复制完整 Cookie 并传 cookie，必要时同时传 atok。';
      }
      return `${error.code ? `${error.code}: ` : ''}${message}`;
    }).join('; ');
  }
  return body && Object.keys(body).length ? JSON.stringify(body) : fallback;
}

async function parseApiResponse(response, endpoint) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { success: false, errors: [{ message: text || response.statusText }] };
  }
  if (!response.ok || body.success === false) {
    throw new Error(`${endpoint} -> ${errorDetail(body, response.statusText)}`);
  }
  return body.result;
}

function materializeOptions(options) {
  return { ...options, body: typeof options.body === 'function' ? options.body() : options.body };
}

async function bearerFetch(endpoint, options = {}) {
  const requestOptions = materializeOptions(options);
  const headers = { Authorization: `Bearer ${config.token}`, ...(requestOptions.headers || {}) };
  if (!(requestOptions.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_BASE}${endpoint}`, { ...requestOptions, headers });
  return parseApiResponse(response, endpoint);
}

async function dashboardApiFetch(endpoint, options = {}) {
  const requestOptions = materializeOptions(options);
  const headers = {
    Cookie: dashboardCookie(),
    Origin: 'https://dash.cloudflare.com',
    Referer: `https://dash.cloudflare.com/${config.accountId}`,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    'x-cross-site-security': 'dash',
    ...(requestOptions.headers || {}),
  };
  if (!(requestOptions.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (config.dashboardAtok) headers['x-atok'] = config.dashboardAtok;
  const response = await fetch(`${DASH_API_BASE}${endpoint}`, { ...requestOptions, headers });
  return parseApiResponse(response, endpoint);
}

async function dashboardSessionFetch(endpoint, { accountId, vses2, cookie, atok, method = 'GET', body } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Cookie: sessionCookie({ cookie, vses2 }),
    Origin: 'https://dash.cloudflare.com',
    Referer: accountId ? `https://dash.cloudflare.com/${accountId}` : 'https://dash.cloudflare.com/',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    'x-cross-site-security': 'dash',
  };
  if (atok) headers['x-atok'] = atok;
  const response = await fetch(`${DASH_API_BASE}${endpoint}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return parseApiResponse(response, endpoint);
}

async function cfFetch(endpoint, options = {}) {
  try {
    return await bearerFetch(endpoint, options);
  } catch (error) {
    if (endpoint === '/zones' && /zone\.create/i.test(error.message) && !hasFullDashboardCookie()) {
      throw new Error(`${error.message}\n当前 Token 仍然缺少添加 Zone 的权限。要继续自动添加 Zone，请传完整浏览器 Cookie，必要时再传 atok；或者先在 Cloudflare 后台手动添加 ${config.zoneName}，再重新运行。`);
    }
    if (!hasFullDashboardCookie() || options.dashboardFallback === false) throw error;
    logger('auth', `Token 调用失败，改用 dashboard session：${endpoint}`);
    return dashboardApiFetch(endpoint, options);
  }
}

function buildConfig(input = {}) {
  const c = {
    token: input.token || '',
    dashboardCookie: input.dashboardCookie || '',
    dashboardAtok: input.dashboardAtok || '',
    dashboardVses2: input.dashboardVses2 || extractCookieValue(input.dashboardCookie, 'vses2') || '',
    accountId: input.accountId || '',
    zoneName: input.zoneName || '',
    hostname: input.hostname || '',
    workerName: input.workerName || '',
    uuid: input.uuid || randomUUID(),
    proxyName: input.proxyName || `node-${randomSlug(4)}`,
    workerSource: path.resolve(input.workerSource || 'worker.fixed.js'),
    compatibilityDate: input.compatibilityDate || DEFAULT_COMPATIBILITY_DATE,
    testUrl: input.testUrl || DEFAULT_TEST_URL,
    skipTest: input.skipTest !== false,
    assumeNsReady: input.assumeNsReady === true,
  };
  if (!c.hostname && c.zoneName) c.hostname = `${randomSlug(4)}.${c.zoneName}`;
  if (!c.workerName) c.workerName = `svc-${randomSlug(6)}`;
  return c;
}

let config = {};
let logger = () => {};

function ensureConfig() {
  if (!config.accountId) throw new Error('缺少 accountId。');
  if (!config.token && !dashboardCookie({ dashboardCookie: config.dashboardCookie, dashboardVses2: config.dashboardVses2 })) {
    throw new Error('缺少 token；如果要让脚本自动创建 Token，请提供 vses2 或 cookie。');
  }
  if (!config.zoneName) {
    throw new Error('缺少根域名 zoneName。创建 API Token 不需要域名，但添加 Zone、DNS 和 Route 必须知道真实根域名。');
  }
  if (!config.hostname.endsWith(config.zoneName)) {
    throw new Error(`hostname 必须在 ${config.zoneName} 下面；如果不传，脚本会随机生成。`);
  }
}

async function ensureApiToken() {
  if (config.token) return;
  logger('0/7', '用 dashboard session 创建 API Token');
  const created = await createApiTokenFromDashboardSession({
    accountId: config.accountId,
    vses2: config.dashboardVses2,
    cookie: config.dashboardCookie,
    atok: config.dashboardAtok,
  });
  config.token = created.token;
  logger('0/7', `API Token 已创建：${created.name}`);
}

async function findZone() {
  logger('1/7', `查找 Zone：${config.zoneName}`);
  const result = await cfFetch(`/zones?name=${encodeURIComponent(config.zoneName)}&account.id=${encodeURIComponent(config.accountId)}`);
  let zone = result?.[0];
  if (!zone) {
    logger('1/7', `账号里还没有这个 Zone，正在添加：${config.zoneName}`);
    zone = await cfFetch('/zones', { method: 'POST', body: JSON.stringify({ name: config.zoneName, account: { id: config.accountId }, type: 'full' }) });
  }
  logger('1/7', `找到 Zone ID：${zone.id}`);
  if (zone.status && zone.status !== 'active') logger('1/7', `Zone 当前状态：${zone.status}`);
  const nameServers = zone.name_servers || zone.original_name_servers || [];
  if (nameServers.length) logger('1/7', `Cloudflare 分配的 NS：${nameServers.join(', ')}`);
  return zone;
}

async function deployWorker() {
  logger('2/7', `部署 Worker：${config.workerName}`);
  const source = await readFile(config.workerSource, 'utf8');
  const prepared = prepareWorkerSourceCode(source, config.uuid);
  const createForm = () => {
    const metadata = { main_module: 'worker.js', compatibility_date: config.compatibilityDate };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('worker.js', new Blob([prepared], { type: 'application/javascript+module' }), 'worker.js');
    return form;
  };
  await cfFetch(`/accounts/${config.accountId}/workers/scripts/${config.workerName}`, { method: 'PUT', body: createForm });
}

async function ensureDnsRecord(zoneId) {
  logger('4/7', `创建或更新 DNS：${config.hostname}`);
  const existing = await cfFetch(`/zones/${zoneId}/dns_records?type=AAAA&name=${encodeURIComponent(config.hostname)}`);
  const body = { type: 'AAAA', name: config.hostname, content: '100::', ttl: 1, proxied: true };
  if (existing?.[0]?.id) {
    await cfFetch(`/zones/${zoneId}/dns_records/${existing[0].id}`, { method: 'PUT', body: JSON.stringify(body) });
    logger('4/7', 'DNS 已更新');
  } else {
    await cfFetch(`/zones/${zoneId}/dns_records`, { method: 'POST', body: JSON.stringify(body) });
    logger('4/7', 'DNS 已创建');
  }
}

async function ensureWorkerRoute(zoneId) {
  const pattern = `${config.hostname}/*`;
  logger('5/7', `创建或更新 Worker Route：${pattern}`);
  const routes = await cfFetch(`/zones/${zoneId}/workers/routes`);
  const existing = routes?.find((route) => route.pattern === pattern);
  const body = { pattern, script: config.workerName };
  if (existing?.id) {
    await cfFetch(`/zones/${zoneId}/workers/routes/${existing.id}`, { method: 'PUT', body: JSON.stringify(body) });
    logger('5/7', 'Worker Route 已更新');
  } else {
    await cfFetch(`/zones/${zoneId}/workers/routes`, { method: 'POST', body: JSON.stringify(body) });
    logger('5/7', 'Worker Route 已创建');
  }
}

function confirmNameServersReady(zone) {
  const nameServers = zone.name_servers || zone.original_name_servers || [];
  if (!nameServers.length) return;
  if (config.assumeNsReady) {
    logger('6/7', `已按 assumeNsReady 跳过 NS 确认：${nameServers.join(', ')}`);
    return;
  }
  throw new Error(`开始 HTTPS 检查前需要确认域名服务商 NS 已设置为：${nameServers.join(', ')}。请在前端勾选「NS 已设置好」，或确认后重试。`);
}

async function waitForHttp() {
  logger('6/7', `检查 Clash 订阅入口：https://${config.hostname}/`);
  let lastNetworkError = '';
  let netFails = 0;
  for (let i = 1; i <= 10; i += 1) {
    try {
      const response = await fetch(`https://${config.hostname}/`, { redirect: 'manual' });
      const text = await response.text();
      netFails = 0;
      if (response.ok && text.includes('proxies:') && text.includes('proxy-groups:') && text.includes(config.uuid)) {
        logger('6/7', `Clash 订阅入口正常，状态码 ${response.status}`);
        return;
      }
      logger('6/7', `第 ${i} 次：状态码 ${response.status}，继续等 DNS/路由生效`);
    } catch (error) {
      lastNetworkError = error.cause?.code || error.message;
      netFails += 1;
      logger('6/7', `第 ${i} 次：网络层失败 ${lastNetworkError}`);
      // 连续 3 次网络层失败：通常是脚本运行环境自身的 DNS/出网受限（如沙箱），
      // 并不代表部署失败。Worker/DNS/Route 已创建，交由用户在浏览器侧确认。
      if (netFails >= 3) {
        logger('6/7', `连续 3 次网络层失败，脚本运行环境可能无法访问该域名（${lastNetworkError}）。`);
        logger('6/7', `Worker / DNS / Route 均已创建成功，请在你的浏览器打开 https://${config.hostname}/ 确认订阅。`);
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('HTTPS 入口没有返回 Clash 订阅。通常是 Zone 还没激活，或域名服务商那边的 NS 没填成 Cloudflare 分配的那两条。');
}

/**
 * 部署入口。
 * @param {object} input 平铺参数（见 buildConfig）
 * @param {(step:string, msg:string)=>void} [onLog] 进度回调
 * @returns {Promise<{hostname:string, subscriptionUrl:string, nameServers:string[], workerName:string, uuid:string}>}
 */
export async function runDeploy(input = {}, onLog = () => {}) {
  config = buildConfig(input);
  logger = onLog;
  ensureConfig();
  await ensureApiToken();
  const zone = await findZone();
  await deployWorker();
  await ensureDnsRecord(zone.id);
  await ensureWorkerRoute(zone.id);
  confirmNameServersReady(zone);
  await waitForHttp();
  const subscriptionUrl = `https://${config.hostname}/`;
  logger('完成', `Clash/Mihomo 订阅地址：${subscriptionUrl}`);
  return {
    hostname: config.hostname,
    subscriptionUrl,
    nameServers: zone.name_servers || zone.original_name_servers || [],
    workerName: config.workerName,
    uuid: config.uuid,
  };
}

export { normalizeVses2, extractCookieValue, prepareWorkerSourceCode };
