import express from 'express';
import { APP_VERSION, findEdge, findFont } from '../config.mjs';
import { WATERMARK_TEMPLATES } from '../watermark-templates.mjs';
import { PDF_TOOLS, MEDIA_TOOLS, NET_TOOLS } from '../tool-catalog.mjs';
import { dbState } from '../lib/db.mjs';
import { mediaHealth } from '../lib/media.mjs';
import { ah } from '../lib/async.mjs';
import { ID_PRESETS } from './idphoto.mjs';
import { NATIVE_TOOLS, SKIP_SUITE } from '../../public/js/tools/catalog.mjs';

const ALL_SUITE_TOOLS = [...PDF_TOOLS, ...MEDIA_TOOLS, ...NET_TOOLS];
const SUITE_TOOL_COUNT = ALL_SUITE_TOOLS.length;
const NATIVE_TOOL_COUNT = NATIVE_TOOLS.length;
// 与前端一致：套件里与自研工具重复的入口不重复计入（pdf-split / pdf-img2pdf）
const SKIPPED = new Set([...SKIP_SUITE].filter((id) => ALL_SUITE_TOOLS.some((t) => t.id === id)));
const TOOL_COUNT = SUITE_TOOL_COUNT + NATIVE_TOOL_COUNT - SKIPPED.size;

export const metaRouter = express.Router();

metaRouter.get('/api/health', ah(async (_req, res) => {
  res.json({
    ok: true,
    version: APP_VERSION,
    db: dbState(),
    media: await mediaHealth(),
    font: Boolean(findFont()),
    edge: Boolean(findEdge()),
  });
}));

metaRouter.get('/api/app', ah(async (req, res) => {
  res.json({
    ok: true,
    version: APP_VERSION,
    watermarkTemplates: WATERMARK_TEMPLATES,
    suites: { pdf: PDF_TOOLS, media: MEDIA_TOOLS, net: NET_TOOLS },
    suiteToolCount: SUITE_TOOL_COUNT,
    nativeToolCount: NATIVE_TOOL_COUNT,
    toolCount: TOOL_COUNT,
    idPresets: ID_PRESETS,
    capabilities: { font: Boolean(findFont()), edge: Boolean(findEdge()) },
    db: dbState(),
    media: await mediaHealth(),
    auth: {
      enabled: dbState().available,
      user: req.user ? { id: req.user.id, username: req.user.username, role: req.user.role, displayName: req.user.displayName || '' } : null,
      modules: req.userModules || [],
    },
  });
}));

metaRouter.get('/api/watermark/templates', (_req, res) => {
  res.json({ ok: true, templates: WATERMARK_TEMPLATES });
});
