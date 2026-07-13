const form = document.getElementById('deploy-form');
const btn = document.getElementById('deploy-btn');
const logEl = document.getElementById('log');
const resultEl = document.getElementById('result');
const subUrlEl = document.getElementById('sub-url');
const copyBtn = document.getElementById('copy-btn');

function appendLog(step, msg) {
  const line = document.createElement('div');
  line.className = 'log-line';
  const tag = document.createElement('span');
  tag.className = 'log-step';
  tag.textContent = step;
  const text = document.createElement('span');
  text.textContent = msg;
  line.append(tag, text);
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
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
          appendLog('错误', obj.error);
        } else if (obj.done) {
          subUrlEl.textContent = obj.result.subscriptionUrl;
          resultEl.hidden = false;
          appendLog('完成', `订阅地址：${obj.result.subscriptionUrl}`);
        } else {
          appendLog(obj.step || '', obj.msg || '');
        }
      }
    }
  } catch (err) {
    appendLog('错误', `网络异常：${err.message}`);
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
