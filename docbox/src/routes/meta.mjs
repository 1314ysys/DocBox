import express from 'express';
import { APP_VERSION, findEdge, findFont } from '../config.mjs';
import { WATERMARK_TEMPLATES } from '../watermark-templates.mjs';
import { PDF_TOOLS, MEDIA_TOOLS, NET_TOOLS } from '../tool-catalog.mjs';
import { dbState } from '../lib/db.mjs';
import { mediaHealth } from '../lib/media.mjs';
import { ah } from '../lib/async.mjs';
import { ID_PRESETS } from './idphoto.mjs';

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

metaRouter.get('/api/app', ah(async (_req, res) => {
  res.json({
    ok: true,
    version: APP_VERSION,
    watermarkTemplates: WATERMARK_TEMPLATES,
    suites: { pdf: PDF_TOOLS, media: MEDIA_TOOLS, net: NET_TOOLS },
    tools: [...PDF_TOOLS, ...MEDIA_TOOLS, ...NET_TOOLS],
    idPresets: ID_PRESETS,
    capabilities: { font: Boolean(findFont()), edge: Boolean(findEdge()) },
    db: dbState(),
    media: await mediaHealth(),
  });
}));

metaRouter.get('/api/watermark/templates', (_req, res) => {
  res.json({ ok: true, templates: WATERMARK_TEMPLATES });
});
