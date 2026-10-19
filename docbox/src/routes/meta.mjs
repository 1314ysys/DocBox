import express from 'express';
import { APP_VERSION, findEdge, findFont, STIRLING_BASE } from '../config.mjs';
import { stirlingInfo } from '../lib/stirling.mjs';
import { WATERMARK_TEMPLATES } from '../watermark-templates.mjs';
import { STIRLING_TOOLS, STIRLING_CATS, STIRLING_UNAVAILABLE } from '../stirling-tools.mjs';
import { ah } from '../lib/async.mjs';
import { ID_PRESETS } from './idphoto.mjs';

export const metaRouter = express.Router();

metaRouter.get('/api/health', ah(async (_req, res) => {
  res.json({ ok: true, version: APP_VERSION, stirling: await stirlingInfo(), font: Boolean(findFont()), edge: Boolean(findEdge()) });
}));

metaRouter.get('/api/app', ah(async (_req, res) => {
  res.json({
    ok: true,
    version: APP_VERSION,
    stirlingBase: STIRLING_BASE,
    stirling: await stirlingInfo(),
    watermarkTemplates: WATERMARK_TEMPLATES,
    stirlingTools: STIRLING_TOOLS,
    stirlingCats: STIRLING_CATS,
    stirlingUnavailable: STIRLING_UNAVAILABLE,
    idPresets: ID_PRESETS,
    capabilities: { font: Boolean(findFont()), edge: Boolean(findEdge()) },
  });
}));

metaRouter.get('/api/watermark/templates', (_req, res) => {
  res.json({ ok: true, templates: WATERMARK_TEMPLATES });
});
