# DeepSeek Harness 桌面版（dsh-desktop）

一个**自包含**的 Electron 桌面应用，把 DeepSeek Harness Web GUI 装进独立桌面窗口。安装包内置了 portable Node 运行时与完整的 dsh 运行时，对方机器**无需预装 Node 或 dsh**，装完即可使用。

## 功能

- 独立窗口加载本地 Web GUI，标题跟随当前会话
- 启动时自动探测端口：已运行则直接加载，未运行则用**捆绑的 portable Node + dsh** 自动拉起服务
- 首次运行自动初始化 dsh 配置（`~/.dsh`）
- **系统托盘常驻**：关闭窗口最小化到托盘，托盘菜单可「显示 / 退出」
- 单实例锁、站内链接留窗口、外部链接交系统浏览器
- 服务起不来时展示本地错误页并给出恢复提示
- 官方 DeepSeek 鲸鱼 logo（主图标白底黑鲸，托盘透明底黑鲸）

## 分发与安装

**正式安装包**：`release\DeepSeekHarness-Setup-0.1.0.exe`（约 173MB，NSIS 安装向导，可选目录，自动创建桌面/开始菜单快捷方式与卸载程序）。对方双击安装即可，**无需 Node / dsh / npm**。默认安装到：

```
%LOCALAPPDATA%\Programs\DeepSeek Harness\
```

**便携版**（可选）：`release\DeepSeekHarness-0.1.0.exe`（单文件，双击即用）。

> **使用前需要 API Key**：应用本身自包含，但 agent 干活需要 DeepSeek API Key。首次打开后，在 GUI 的模型设置里填入自己的 key（或设置环境变量 `DEEPSEEK_API_KEY`）即可。

## 开发 / 源码

```sh
npm start         # 开发模式（electron .）
npm run dist:nsis # 打包 NSIS 安装包到 release/
npm run dist      # 打包 NSIS 安装包 + portable 便携版
```

- 捆绑运行时在 `runtime/`（`node.exe` + `dsh/`），由 `build.extraResources` 打进安装包；该目录体积大、属第三方产物，已被 `.gitignore` 排除。
- 准备 runtime：把 Windows 版 `node.exe` 放入 `runtime/node.exe`，再 `npm install -g @deepseek-ai/dsh` 后把整个 `@deepseek-ai/dsh` 包目录复制为 `runtime/dsh/`。
- 图标由 `assets/generate-icon.js` 从官方 `assets/whale.svg` 渲染生成。

## 可配置项（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_DESKTOP_HOST` | `127.0.0.1` | Web GUI 监听地址 |
| `DSH_DESKTOP_PORT` | `3080` | Web GUI 端口 |
| `DSH_DESKTOP_URL` | `http://127.0.0.1:3080` | 直接指定完整 URL |
| `DSH_DESKTOP_NODE` | `<resources>\runtime\node.exe` | 捆绑的 Node 路径（一般无需改） |
| `DSH_DESKTOP_BIN` | `<resources>\runtime\dsh\lib\bin.js` | 捆绑的 dsh 入口（一般无需改） |
| `DSH_DESKTOP_CWD` | 用户主目录 | 拉起服务时的工作目录 |
| `DSH_HOME` | `~/.dsh` | dsh 配置目录（首次运行自动初始化） |

## 已知限制

- 未做代码签名，Windows SmartScreen 可能提示「未知发布者」，选「仍要运行」即可。
- 需对方自行配置 DeepSeek API Key（应用不自带 key）。
