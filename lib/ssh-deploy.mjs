// 方案一 SSH 远程部署：把生成的安装脚本经 stdin 传到远端 VPS 执行。
// 仅用 Node 内置模块（child_process.spawn），不引第三方包。
// 注意：依赖远端环境有 sshpass + openssh（Termux: pkg install openssh sshpass）。

import { spawn } from 'node:child_process';
import { extractVlessLink } from './gen-command.mjs';

function which(cmd) {
  return new Promise((resolve) => {
    const p = spawn('sh', ['-c', `command -v ${cmd}`]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => resolve(out.trim()));
  });
}

// input: { host, port, user, password, script }
// logger(step, msg) 用于流式回传
// 返回 { vlessUrl }
export async function runSshDeploy(input, logger = () => {}) {
  const host = String(input.host || '').trim();
  const port = Number(input.port) || 22;
  const user = String(input.user || '').trim();
  const password = String(input.password || '');
  const script = String(input.script || '');

  if (!host) throw new Error('缺少 VPS 主机地址 (host)。');
  if (!user) throw new Error('缺少 VPS 登录用户名 (user)。');
  if (!password) throw new Error('缺少 VPS 登录密码 (password)。');
  if (!script) throw new Error('缺少要执行的安装脚本。');

  const sshpass = await which('sshpass');
  const ssh = await which('ssh');
  if (!sshpass) {
    throw new Error('远端执行需要 sshpass（Termux: pkg install sshpass；Debian: apt install sshpass）。');
  }
  if (!ssh) {
    throw new Error('未找到 ssh 客户端，请先安装 openssh。');
  }

  logger('连接', `SSH → ${user}@${host}:${port}`);

  return new Promise((resolve, reject) => {
    const child = spawn(
      sshpass,
      [
        '-p', password,
        ssh,
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'ConnectTimeout=15',
        '-p', String(port),
        `${user}@${host}`,
        'bash -s', // 从 stdin 读取脚本
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    let buffer = '';
    let fullLog = '';

    const flush = () => {
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (line.trim()) {
          fullLog += line + '\n';
          logger('远端', line);
        }
      }
    };

    child.stdin.write(script);
    child.stdin.end();

    child.stdout.on('data', (d) => { buffer += d.toString(); flush(); });
    child.stderr.on('data', (d) => { buffer += d.toString(); flush(); });

    child.on('error', (err) => reject(new Error(`启动 sshpass 失败: ${err.message}`)));
    child.on('close', (code) => {
      // 处理最后一行（无换行结尾）
      if (buffer.trim()) { fullLog += buffer.trim() + '\n'; logger('远端', buffer.trim()); }
      if (code === 0) {
        const vlessUrl = extractVlessLink(fullLog);
        if (!vlessUrl) {
          logger('提示', '脚本执行完毕，但未检测到分享链接，请检查上方日志。');
        }
        resolve({ vlessUrl, log: fullLog });
      } else {
        reject(new Error(`远端执行退出码 ${code}。常见原因：密码错误、主机不可达、或脚本中途报错（见上方日志）。`));
      }
    });
  });
}
