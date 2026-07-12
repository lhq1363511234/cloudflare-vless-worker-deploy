# Cloudflare Worker 自动部署

这套脚本面向刚创建、账号里还没有 Zone 的 Cloudflare 账号。

- `deploy-cloudflare-vless.mjs`：自动创建 Token、添加 Zone、部署 Worker、创建 DNS 和 Worker Route。
- `worker.fixed.js`：Worker 源码，部署时会替换成随机 UUID；普通访问会返回 Clash/Mihomo 订阅。

## 最短用法

只需要账号 ID、`vses2` 和真实根域名。Token 创建不需要域名，但添加 Zone/DNS/Route 必须知道要接入哪个域名。

```bash
node deploy-cloudflare-vless.mjs \
  --account-id '你的 Cloudflare 账号 ID' \
  --vses2 '你的 vses2 cookie 值' \
  --zone akkka.ccwu.cc
```

默认会随机生成：

- Worker 名称
- 绑定的子域名
- VLESS UUID
- 本机测试用的 Clash/Mihomo 节点名

API Token 创建前会先调用 `/user/tokens/permission_groups`，把脚本内置的权限名解析成当前账号可用的权限组 ID。默认权限覆盖：

- 账号级：`Account Settings Read`、`Workers Scripts Read`、`Workers Scripts Write`
- Zone 级：`Zone Read`、`Zone Write`、`DNS Read`、`DNS Write`、`Workers Routes Read`、`Workers Routes Write`

如果 Cloudflare 安全页拦住了 dashboard session，再传完整浏览器 Cookie，必要时再传 `x-atok`：

```bash
node deploy-cloudflare-vless.mjs \
  --account-id '你的 Cloudflare 账号 ID' \
  --cookie '浏览器请求里的完整 Cookie 字符串' \
  --atok '浏览器请求里的 x-atok 值' \
  --zone akkka.ccwu.cc
```

如果 Cloudflare 仍然提示没有 `zone.create` 权限，可以先在 Cloudflare 后台手动添加根域名，再用最短命令继续。

创建 DNS 和 Worker Route 后，脚本会先让你确认域名服务商里的 NS 已经改成 Cloudflare 分配的两条，再开始 HTTPS 检查。确认后输入 `y` 继续。已经确认过时，可以加 `--assume-ns-ready` 跳过这一步。

部署完成后，直接打开 `https://生成的子域名/` 会返回 Clash/Mihomo 订阅 YAML，可以直接导入 Clash Verge。WebSocket 请求仍然走代理，不受订阅页面影响。

脚本会直接调用 Cloudflare API，不再依赖浏览器控制台脚本或 `wrangler`。

## 可选参数

```bash
node deploy-cloudflare-vless.mjs \
  --account-id '你的 Cloudflare 账号 ID' \
  --vses2 '你的 vses2 cookie 值' \
  --zone akkka.ccwu.cc \
  --hostname abc123.akkka.ccwu.cc \
  --worker-name svc-abc123 \
  --uuid '固定 UUID' \
  --proxy-name '固定节点名' \
  --assume-ns-ready \
  --skip-test
```

`vses2` 是登录态，不要写进仓库或发到聊天记录里。用完后可以在 Cloudflare 里撤销这个临时 Token。
