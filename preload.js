'use strict';

const { contextBridge } = require('electron');

// 最小桥接：仅暴露运行环境信息，供 Web GUI 识别自己跑在桌面壳里（可选扩展点）
contextBridge.exposeInMainWorld('dshDesktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
