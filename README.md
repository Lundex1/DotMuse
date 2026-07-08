# 点灵 DotMuse

一个给美术创作者的本地参考图管理工具：内置浏览器逛图、一键收藏入库、自由画布拼图板、灵感笔记，全流程在一个软件里完成。

**免费开源（MIT 协议），所有数据只保存在你自己的电脑上，不上传任何服务器。** 个人开发，做出来觉得好用，分享给有同样需求的人。

> DotMuse is a free, open-source, local-first reference image manager for artists — built-in browser capture, library organizing, a PureRef-style board canvas and idea notes. UI available in **中文 / English / 日本語**.

![Electron](https://img.shields.io/badge/Electron-33-9feaf9) ![React](https://img.shields.io/badge/React-18-61dafb) ![License](https://img.shields.io/badge/License-MIT-green) ![Platform](https://img.shields.io/badge/Windows-10%2F11-blue)

---

## 功能

### 收图
- **内置浏览器**：直接逛 Pinterest / ArtStation / 花瓣（常用网站可自行增删），鼠标悬停图片点「✦ 收藏」即入库
- **来源记录**：每张图自动记住来源网页和作者，详情页可一键跳回原页
- **剪贴板监听**（可选开启）：在任何软件里复制图片（Ctrl+C）自动入库
- **本地导入**：批量选择文件导入，或直接把图片拖进窗口
- **自动查重**：按内容指纹判重，同一张图不会存两遍

### 整理
- 素材库瀑布流浏览，按标题 / 作者 / 标签 / 备注搜索
- 自建分类（合集）：卡片拖到分类上即归类；分类内可**置顶**常用图
- 多选模式：批量加入图板、批量删除
- 首次启动可选**创作方向**（场景 / 角色 / 插画 / UI / 通用），按方向预建一套推荐分类
- 详情页方向键 ← → 快速翻图

### 工作图板（自由画布）
- 类 PureRef 的无限画布：拖拽摆放、缩放、旋转（R / Shift+R）、水平镜像、锁定
- **复制副本**：Alt+拖拽直接拖出一份 / Ctrl+C → Ctrl+V / Ctrl+D
- 分组方框（拖拽框选生成）、文字标注（字体字号颜色可调）
- 多选对齐：左右顶底对齐 / 等高等宽 / 一键整理
- **Ctrl+Z 撤销**（最近 60 步）
- 图板可整体**导出 PNG**，或弹出**置顶悬浮小窗**边画边看
- **图板分享（.dlb 文件）**：一个文件打包整板（图片 + 摆放 + 标注 + 来源），别人导入即原样还原；导入时可选择图片是否进素材库

### 灵感笔记
- 按日期自动归档，支持基础排版
- 一键复制全文，方便粘给任何 AI 继续展开

### AI 助手（网页版集成）
- 侧边栏内嵌 DeepSeek / 豆包 / ChatGPT / Gemini / Claude 网页版，登录一次持久保持
- 面板宽度可拖拽调节
- 说明：本版本不内置 AI 引擎、不需要任何 API Key；AI 能力即上述网页版本身

### 其他
- 界面 **中 / 英 / 日** 三语，默认跟随系统语言，可随时切换
- 浅色 / 深色主题
- 全局搜索（Ctrl+K）：素材、图板、笔记一个框搜完
- 横竖窗口尺寸均做了适配

---

## 下载安装

去 [Releases](../../releases) 页面下载最新的 `点灵 DotMuse Setup x.x.x.exe`，双击安装。

- ⚠️ 首次运行如遇 Windows SmartScreen 蓝色提示，点「**更多信息 → 仍要运行**」。这是开源软件未购买代码签名证书的正常现象
- 首次启动会引导选择**素材库存放位置**（所有图片、图板、笔记都存在这一个文件夹里）和创作方向
- 升级：直接安装新版覆盖，数据全部保留，无需卸载

## 数据与迁移

- 素材库文件夹结构：`originals/`（原图）+ `thumbs/`（缩略图）+ `refhub.db`（数据库）
- **备份 / 迁移 = 整个文件夹拷走**，换电脑后在设置里把位置指回来即可
- 素材库位置可随时在「设置 → 存储」更改（支持迁移复制）

## 从源码运行 / 构建

需要 Node.js 18+（Windows）。

```bash
npm install        # .npmrc 已配置从 Electron 官方源取 better-sqlite3 预编译二进制
npm run dev        # 开发模式（Vite + Electron）
npm run build      # 构建前端
npm run dist       # 打包 NSIS 安装程序（输出在 release/）
```

## 常见问题

| 问题 | 说明 |
|---|---|
| 安装时被 Windows 拦截 | 「更多信息 → 仍要运行」，无签名证书的正常现象 |
| 内置浏览器登 Google 提示不安全 | 已做兼容处理，多数情况可正常登录；不行可在目标网站改用邮箱登录 |
| 更改素材库位置提示没有权限 | 弹窗里点「以管理员身份重启」授权后再改一次 |
| 图板 / 方框改名 | 右键 → 重命名 |
| 网页显示语言和应用语言不一致 | 网页语言由网站自己决定（语言协商 / IP / 账号设置），应用已把语言偏好同步给内嵌浏览器，但网站不一定遵循 |

## 声明

- 本项目为个人业余作品，按 [MIT 协议](LICENSE) 开源，免费使用，仅作分享，不提供任何担保
- Pinterest、ArtStation、花瓣、DeepSeek、豆包、ChatGPT、Gemini、Claude 等均为其各自所有者的商标；本软件仅通过内嵌网页方式访问上述公开网站，与上述公司均无关联
- 请在遵守各素材网站服务条款及版权规定的前提下使用采集功能
