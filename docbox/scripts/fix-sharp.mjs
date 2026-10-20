#!/usr/bin/env node
/**
 * @xenova/transformers 自带的 sharp@0.32 在 Windows 上没有可用的预编译二进制，
 * 安装时（--ignore-scripts / 镜像缺 secondary build）会残留一个坏掉的嵌套 sharp，
 * 导致 import('@xenova/transformers') 直接抛错。这里在启动前把它删掉，
 * 让 Node 解析到项目根目录可用的 sharp（转写只用音频管线，不受影响）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'node_modules', '@xenova', 'transformers', 'node_modules', 'sharp');
try {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log('[fix-sharp] 已移除 @xenova/transformers 下的嵌套 sharp（改用项目根目录 sharp）');
  }
} catch (err) {
  console.warn('[fix-sharp] 跳过：' + err.message);
}
