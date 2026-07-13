// ===== Tab 切换 =====
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => (p.hidden = true));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).hidden = false;
  });
});

// ===== 方案一 子 Tab 切换 =====
document.querySelectorAll('.sub-tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sub-tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.sub-panel').forEach((p) => (p.hidden = true));
    btn.classList.add('active');
    document.getElementById(btn.dataset.sub).hidden = false;
  });
});

// ===== 方案二：CF 一键部署（保留） =====
const form = document.getElementById('deploy-form');
const btn = document.getElementById('deploy-btn');
const logEl = document.getElementById('log');
const resultEl = document.getElementById('result');
const subUrlEl = document.getElementById('sub-url');
const copyBtn = document.getElementById('copy-btn');

function appendLog(el, step, msg) {
  const line = document.createElement('div');
  line.className = 'log-line';
  const tag = document.createElement('span');
  tag.className = 'log-step';
  tag.textContent = step;
  const text = document.createElement('span');
  text.textContent = msg;
  line.append(tag, text);
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  resultEl.hidden = true;
  logEl.hidden = false;
  logEl.innerHTML = '';
  btn.disabled = true;
  btn.textContent = '部署中…';

  const fd = new FormData(form);
  const payload = {
    accountId: fd.get('accountId')?.trim(),
    zone: fd.get('zone')?.trim(),
    vses2: fd.get('vses2')?.trim(),
    cookie: fd.get('cookie')?.trim(),
    atok: fd.get('atok')?.trim(),
    token: fd.get('token')?.trim(),
    hostname: fd.get('hostname')?.trim(),
    workerName: fd.get('workerName')?.trim(),
    uuid: fd.get('uuid')?.trim(),
    assumeNsReady: fd.get('assumeNsReady') === 'on',
    skipTest: fd.get('skipTest') === 'on',
  };

  try {
    const resp = await fetch('/api/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let obj;
        try { obj = JSON.parse(line); } catch { continue; }
        if (obj.error) {
          appendLog(logEl, '错误', obj.error);
        } else if (obj.done) {
          subUrlEl.textContent = obj.result.subscriptionUrl;
          resultEl.hidden = false;
          appendLog(logEl, '完成', `订阅地址：${obj.result.subscriptionUrl}`);
        } else {
          appendLog(logEl, obj.step || '', obj.msg || '');
        }
      }
    }
  } catch (err) {
    appendLog(logEl, '错误', `网络异常：${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '部署';
  }
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(subUrlEl.textContent);
    copyBtn.textContent = '已复制';
    setTimeout(() => (copyBtn.textContent = '复制'), 1500);
  } catch {
    copyBtn.textContent = '复制失败';
  }
});

// ===== 方案一①：生成安装脚本 =====
const genBtn = document.getElementById('gen-btn');
const genOut = document.getElementById('gen-out');
const genScript = document.getElementById('gen-script');
const genCopy = document.getElementById('gen-copy');

genBtn.addEventListener('click', async () => {
  const panel = document.getElementById('gen');
  const payload = {
    style: 'installer',
    protocol: panel.querySelector('[name=protocol]').value,
    port: panel.querySelector('[name=port]').value,
    uuid: panel.querySelector('[name=uuid]').value.trim(),
    serverName: panel.querySelector('[name=serverName]').value.trim(),
    name: panel.querySelector('[name=name]').value.trim(),
  };
  genBtn.disabled = true;
  genBtn.textContent = '生成中…';
  try {
    const resp = await fetch('/api/gen-command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (data.error) {
      genScript.textContent = '错误：' + data.error;
    } else {
      genScript.textContent = data.command;
    }
    genOut.hidden = false;
  } catch (err) {
    genScript.textContent = '网络异常：' + err.message;
    genOut.hidden = false;
  } finally {
    genBtn.disabled = false;
    genBtn.textContent = '生成命令';
  }
});

genCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(genScript.textContent);
    genCopy.textContent = '已复制';
    setTimeout(() => (genCopy.textContent = '复制脚本'), 1500);
  } catch {
    genCopy.textContent = '复制失败';
  }
});

// ===== 方案一②：SSH 一键部署 =====
const sshBtn = document.getElementById('ssh-btn');
const sshLog = document.getElementById('ssh-log');
const sshResult = document.getElementById('ssh-result');
const sshUrl = document.getElementById('ssh-url');
const sshCopy = document.getElementById('ssh-copy');
const sshPanel = document.getElementById('ssh');

sshBtn.addEventListener('click', async () => {
  const payload = {
    host: sshPanel.querySelector('[name=sshHost]').value.trim(),
    portSsh: sshPanel.querySelector('[name=sshPort]').value.trim(),
    user: sshPanel.querySelector('[name=sshUser]').value.trim(),
    password: sshPanel.querySelector('[name=sshPass]').value,
    protocol: sshPanel.querySelector('[name=sshProtocol]').value,
    port: sshPanel.querySelector('[name=sshPort2]').value,
    serverName: sshPanel.querySelector('[name=sshServerName]').value.trim(),
  };
  sshResult.hidden = true;
  sshLog.hidden = false;
  sshLog.innerHTML = '';
  sshBtn.disabled = true;
  sshBtn.textContent = '部署中…';

  try {
    const resp = await fetch('/api/ssh-deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let obj;
        try { obj = JSON.parse(line); } catch { continue; }
        if (obj.error) {
          appendLog(sshLog, '错误', obj.error);
        } else if (obj.done) {
          if (obj.result.vlessUrl) {
            sshUrl.textContent = obj.result.vlessUrl;
            sshResult.hidden = false;
          }
          appendLog(sshLog, '完成', '部署结束');
        } else {
          appendLog(sshLog, obj.step || '', obj.msg || '');
        }
      }
    }
  } catch (err) {
    appendLog(sshLog, '错误', `网络异常：${err.message}`);
  } finally {
    sshBtn.disabled = false;
    sshBtn.textContent = 'SSH 一键部署';
  }
});

sshCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(sshUrl.textContent);
    sshCopy.textContent = '已复制';
    setTimeout(() => (sshCopy.textContent = '复制'), 1500);
  } catch {
    sshCopy.textContent = '复制失败';
  }
});
