import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { manifest, verifyHash } from './prepare-ios-sidecar.mjs';

// resourceRoot：源码 src-tauri 或产物的 Resources/安装根目录。
export async function checkIosNotices(resourceRoot) {
  const directory = join(resourceRoot, 'third-party', 'go-ios');
  const notice = JSON.parse(await readFile(join(directory, 'NOTICE.json'), 'utf8'));
  const expected = {
    component: 'go-ios', version: manifest.version,
    source: 'https://github.com/danielpaulus/go-ios', releaseUrl: manifest.releaseUrl,
    license: manifest.license.spdx, licenseSource: manifest.license.source,
    licenseFile: 'LICENSE.txt',
  };
  for (const [key, value] of Object.entries(expected)) {
    if (notice[key] !== value) throw new Error(`go-ios 许可记录不一致：${key}，期望 ${value}`);
  }
  if (!notice.distribution || !notice.appleComponents) throw new Error('go-ios 随包说明缺少分发或 Apple 组件记录');
  await verifyHash(join(directory, 'LICENSE.txt'), manifest.license.sha256);
}
