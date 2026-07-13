#!/usr/bin/env node
// CLI 壳：解析参数/环境变量后调用 lib/deploy.mjs 的 runDeploy。
// 行为与原版一致（参数名、环境变量全部保留），仅把部署逻辑下沉到 lib。

import { runDeploy, extractCookieValue } from './lib/deploy.mjs';

function readArgs(argv) {
  const options = { positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--zone') options.zoneName = argv[++i];
    else if (arg === '--account-id') options.accountId = argv[++i];
    else if (arg === '--vses2') options.dashboardVses2 = argv[++i];
    else if (arg === '--cookie') options.dashboardCookie = argv[++i];
    else if (arg === '--atok' || arg === '--x-atok') options.dashboardAtok = argv[++i];
    else if (arg === '--api-token') options.token = argv[++i];
    else if (arg === '--hostname') options.hostname = argv[++i];
    else if (arg === '--worker-name') options.workerName = argv[++i];
    else if (arg === '--uuid') options.uuid = argv[++i];
    else if (arg === '--proxy-name') options.proxyName = argv[++i];
    else if (arg === '--worker-source') options.workerSource = argv[++i];
    else if (arg === '--compatibility-date') options.compatibilityDate = argv[++i];
    else if (arg === '--test-url') options.testUrl = argv[++i];
    else if (arg === '--skip-test') options.skipTest = true;
    else if (arg === '--assume-ns-ready' || arg === '--yes') options.assumeNsReady = true;
    else options.positional.push(arg);
  }
  return options;
}

const env = process.env;
const args = readArgs(process.argv.slice(2));

// 环境变量回退（与原版 config 对象保持一致）
const input = {
  token: args.token || env.CF_API_TOKEN || env.CLOUDFLARE_API_TOKEN,
  dashboardCookie: args.dashboardCookie || env.CF_DASH_COOKIE || '',
  dashboardAtok: args.dashboardAtok || env.CF_DASH_ATOK || '',
  dashboardVses2:
    args.dashboardVses2
    || extractCookieValue(args.dashboardCookie || env.CF_DASH_COOKIE, 'vses2')
    || env.CF_DASH_VSES2 || env.CF_VSES2 || env.VSES2,
  accountId: args.accountId || env.CF_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID,
  zoneName: args.zoneName || env.CF_ZONE_NAME || env.ZONE_NAME || args.positional[0] || '',
  hostname: args.hostname || env.CF_HOSTNAME || env.HOSTNAME || '',
  workerName: args.workerName || env.CF_WORKER_NAME || env.WORKER_NAME || '',
  uuid: args.uuid || env.VLESS_UUID || '',
  proxyName: args.proxyName || env.PROXY_NAME || '',
  workerSource: args.workerSource || env.WORKER_SOURCE || 'worker.fixed.js',
  compatibilityDate: args.compatibilityDate || env.CF_COMPATIBILITY_DATE || '',
  testUrl: args.testUrl || env.TEST_URL || '',
  skipTest: args.skipTest || env.SKIP_TEST === '1' || env.NO_TEST === '1',
  assumeNsReady: args.assumeNsReady || env.ASSUME_NS_READY === '1',
};

function log(step, message) {
  console.log(`[${step}] ${message}`);
}

runDeploy(input, log)
  .then((result) => {
    console.log('\n完成。Clash/Mihomo 订阅地址：\n');
    console.log(result.subscriptionUrl);
    console.log('\n直接把这个地址导入 Clash Verge / Mihomo 即可。');
  })
  .catch((error) => {
    console.error(`\n失败：${error.message}`);
    process.exit(1);
  });
