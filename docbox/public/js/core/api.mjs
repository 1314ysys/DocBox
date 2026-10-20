function handleAuthStatus(status) {
  if (status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('docbox:unauthorized'));
  }
}

export async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  handleAuthStatus(res.status);
  if (!res.ok) throw new Error(data.error || ('请求失败（HTTP ' + res.status + '）'));
  return data;
}

export async function postForm(url, { files = [], fields = {} } = {}) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    body.append(key, String(value));
  }
  for (const file of files) body.append(file.field || 'files', file.file || file, file.name || file?.name || 'file');
  const res = await fetch(url, { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  handleAuthStatus(res.status);
  if (!res.ok || !data.ok) throw new Error(data.error || ('处理失败（HTTP ' + res.status + '）'));
  return data;
}

export function downloadUrl(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name || '';
  a.click();
}

export async function postJson(url, body = {}) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    credentials: 'same-origin', body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  handleAuthStatus(res.status);
  if (!res.ok) throw new Error(data.error || ('请求失败（HTTP ' + res.status + '）'));
  return data;
}
