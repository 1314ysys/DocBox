const RECENT_KEY = 'docbox.recent.v2';
const TEMPLATE_KEY = 'docbox.watermark.templates.v1';

export const store = {
  recent: [],
  templates: {},
};

export function loadStore() {
  try { store.recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') || []; } catch { store.recent = []; }
  try { store.templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '{}') || {}; } catch { store.templates = {}; }
}

export function addRecent(files, toolName) {
  for (const f of files) {
    store.recent.unshift({ name: f.name, url: f.url, size: f.size, tool: toolName, at: Date.now() });
  }
  store.recent = store.recent.slice(0, 16);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(store.recent)); } catch { /* ignore */ }
}

export function clearRecent() {
  store.recent = [];
  try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
}

export function saveTemplate(templateId, values) {
  store.templates[templateId] = { ...(store.templates[templateId] || {}), ...values, updatedAt: Date.now() };
  try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(store.templates)); } catch { /* ignore */ }
}

export function getTemplate(templateId) {
  return store.templates[templateId] || null;
}

export function removeTemplate(templateId) {
  delete store.templates[templateId];
  try { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(store.templates)); } catch { /* ignore */ }
}
