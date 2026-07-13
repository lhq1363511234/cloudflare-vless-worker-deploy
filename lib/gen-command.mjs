// 方案一（VPS 免费小鸡）相关纯函数：生成可一键运行的安装脚本。
// 纯函数、无副作用、无网络调用，便于单测。

const FS_DEFAULTS = {
  vlessreality: 'xtls-rprx-vision',
  vlessws: 'none',
  trojan: 'none',
};

// 把用户输入整理成安全的默认值
export function normalizeInstallerInput(input = {}) {
  const protocol = ['vless-reality', 'vless-ws', 'trojan'].includes(input.protocol)
    ? input.protocol
    : 'vless-reality';

  const port = String(input.port || '').trim();
  const portNum = Number(port);
  const safePort = Number.isInteger(portNum) && portNum > 0 && portNum <= 65535 ? portNum : 443;

  const uuid = String(input.uuid || '').trim();
  // 允许为空（脚本运行时自动生成），但若有值需大致像 UUID
  const safeUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(uuid)
    ? uuid
    : '';

  const serverName = String(input.serverName || '').trim() || 'www.apple.com';
  const name = String(input.name || '').trim() || 'CF-VPS';

  let flow = String(input.flow || '').trim();
  if (!flow) flow = FS_DEFAULTS[protocol.replace('-', '')] || 'none';

  return { protocol, port: safePort, uuid: safeUuid, serverName, name, flow };
}

// 生成一份非交互的 sing-box 安装脚本（bash）。
// 关键点：全部参数在脚本里写死/运行时生成，无需菜单交互。
export function buildInstaller(input = {}) {
  const { protocol, port, uuid, serverName, name, flow } = normalizeInstallerInput(input);

  // VLESS + Reality（免域名免证书，最适合免费小鸡）
  if (protocol === 'vless-reality') {
    return installerReality({ port, uuid, serverName, name, flow });
  }
  // VLESS + WS + TLS（需要域名 + 证书，走 certbot）
  if (protocol === 'vless-ws') {
    return installerWs({ port, uuid, serverName, name, flow });
  }
  // Trojan（需域名证书）
  return installerTrojan({ port, uuid, serverName, name });
}

function installerReality({ port, uuid, serverName, name, flow }) {
  return `#!/usr/bin/env bash
set -euo pipefail

PORT=${port}
UUID="${uuid}"
SERVER_NAME="${serverName}"
FLOW="${flow}"
NAME="${name}"

echo "==> 安装 sing-box"
bash <(curl -fsSL https://sing-box.arpa.pro/install.sh) >/dev/null 2>&1 || { echo "安装失败，请手动安装 sing-box"; exit 1; }

echo "==> 生成 Reality 密钥对与 UUID"
KP=$(sing-box generate reality-keypair)
PRIV=$(echo "$KP" | awk -F': ' '/PrivateKey/{print $2}')
PUB=$(echo "$KP" | awk -F': ' '/PublicKey/{print $2}')
[ -z "$UUID" ] && UUID=$(sing-box generate uuid)
SHORT_ID=$(sing-box generate rand --hex 8)
IP=$(curl -s --max-time 10 https://api.ipify.org)

echo "==> 写入 /etc/sing-box/config.json"
mkdir -p /etc/sing-box
cat > /etc/sing-box/config.json <<EOF
{
  "inbounds": [{
    "type": "vless",
    "tag": "vless-in",
    "listen": "::",
    "listen_port": $PORT,
    "users": [{ "uuid": "$UUID", "flow": "$FLOW" }],
    "tls": {
      "enabled": true,
      "server_name": "$SERVER_NAME",
      "reality": {
        "enabled": true,
        "handshake": { "server": "$SERVER_NAME", "server_port": 443 },
        "private_key": "$PRIV",
        "short_id": "$SHORT_ID"
      }
    }
  }],
  "outbounds": [{ "type": "direct", "tag": "direct" }]
}
EOF

echo "==> 放行防火墙"
if command -v ufw >/dev/null 2>&1; then ufw allow $PORT/tcp; elif command -v iptables >/dev/null 2>&1; then iptables -I INPUT -p tcp --dport $PORT -j ACCEPT; fi

echo "==> 启动 sing-box"
systemctl enable --now sing-box 2>/dev/null || (nohup sing-box run -c /etc/sing-box/config.json >/var/log/sing-box.log 2>&1 &)

sleep 2
echo "===== 分享链接（复制到 v2rayN / Clash） ====="
echo "vless://$UUID@$IP:$PORT?encryption=none&security=reality&type=tcp&flow=$FLOW&pbk=$PUB&fp=chrome&sni=$SERVER_NAME&sid=$SHORT_ID#$NAME"
`;
}

function installerWs({ port, uuid, serverName, name, flow }) {
  return `#!/usr/bin/env bash
set -euo pipefail
# VLESS + WS + TLS：需要先把域名 $SERVER_NAME 解析到本机并申请证书（certbot）。
PORT=${port}
UUID="${uuid}"
SERVER_NAME="${serverName}"
FLOW="${flow}"
NAME="${name}"

bash <(curl -fsSL https://sing-box.arpa.pro/install.sh) >/dev/null 2>&1 || { echo "安装失败"; exit 1; }
[ -z "$UUID" ] && UUID=$(sing-box generate uuid)

certbot certonly --standalone -d "$SERVER_NAME" --non-interactive --agree-tos -m admin@$SERVER_NAME || { echo "证书申请失败，请确认域名已解析到本机且 80 端口可用"; exit 1; }

mkdir -p /etc/sing-box
cat > /etc/sing-box/config.json <<EOF
{
  "inbounds": [{
    "type": "vless",
    "tag": "vless-in",
    "listen": "::",
    "listen_port": $PORT,
    "users": [{ "uuid": "$UUID", "flow": "$FLOW" }],
    "transport": { "type": "ws", "path": "/vless" },
    "tls": {
      "enabled": true,
      "certificate_path": "/etc/letsencrypt/live/$SERVER_NAME/fullchain.pem",
      "key_path": "/etc/letsencrypt/live/$SERVER_NAME/privkey.pem"
    }
  }],
  "outbounds": [{ "type": "direct", "tag": "direct" }]
}
EOF

systemctl enable --now sing-box 2>/dev/null || (nohup sing-box run -c /etc/sing-box/config.json >/var/log/sing-box.log 2>&1 &)
sleep 2
IP=$(curl -s --max-time 10 https://api.ipify.org)
echo "===== 分享链接 ====="
echo "vless://$UUID@$SERVER_NAME:$PORT?encryption=none&security=tls&type=ws&path=%2Fvless&host=$SERVER_NAME#$NAME"
`;
}

function installerTrojan({ port, uuid, serverName, name }) {
  return `#!/usr/bin/env bash
set -euo pipefail
# Trojan：需要域名 $SERVER_NAME 的 TLS 证书（certbot）。
PORT=${port}
UUID="${uuid}"
SERVER_NAME="${serverName}"
NAME="${name}"

bash <(curl -fsSL https://sing-box.arpa.pro/install.sh) >/dev/null 2>&1 || { echo "安装失败"; exit 1; }
[ -z "$UUID" ] && UUID=$(sing-box generate uuid)
PASSWORD="$UUID"

certbot certonly --standalone -d "$SERVER_NAME" --non-interactive --agree-tos -m admin@$SERVER_NAME || { echo "证书申请失败"; exit 1; }

mkdir -p /etc/sing-box
cat > /etc/sing-box/config.json <<EOF
{
  "inbounds": [{
    "type": "trojan",
    "tag": "trojan-in",
    "listen": "::",
    "listen_port": $PORT,
    "users": [{ "password": "$PASSWORD" }],
    "tls": {
      "enabled": true,
      "certificate_path": "/etc/letsencrypt/live/$SERVER_NAME/fullchain.pem",
      "key_path": "/etc/letsencrypt/live/$SERVER_NAME/privkey.pem"
    }
  }],
  "outbounds": [{ "type": "direct", "tag": "direct" }]
}
EOF

systemctl enable --now sing-box 2>/dev/null || (nohup sing-box run -c /etc/sing-box/config.json >/var/log/sing-box.log 2>&1 &)
sleep 2
echo "===== 分享链接 ====="
echo "trojan://$PASSWORD@$SERVER_NAME:$PORT?sni=$SERVER_NAME#$NAME"
`;
}

// 懒人法：fscarmen 社区一键脚本（交互式菜单）。返回可直接复制运行的一行命令。
export function buildFscarmenCommand() {
  return 'bash <(curl -fsSL https://raw.githubusercontent.com/fscarmen/sing-box/main/sing-box.sh)';
}

// 从日志文本中抽取第一个 vless:// / trojan:// 分享链接
export function extractVlessLink(text = '') {
  const m = String(text).match(/(vless|trojan|vmess):\/\/[^\s"'`]+/);
  return m ? m[0] : null;
}
