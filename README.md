# 胖狐生图

胖狐生图是一个 AI 图像生成工作台。当前版本支持通过胖狐 API 的 `gpt-image-2` 模型生成图片，并提供图片预览、历史记录和原图下载功能。

## 使用前准备

请先确认电脑已安装：

- Node.js
- npm

项目根目录需要有 `.env` 文件，用来配置胖狐 API Key、管理员账号和会话密钥。可以参考 `.env.example`。

管理员后台入口：

```text
http://localhost:5173/admin
```

普通用户需要先由管理员在后台创建账号，并配置可用生图次数后才能登录使用。

## 启动项目

Windows 用户可以直接双击：

```text
start.bat
```

脚本会自动检查默认端口是否被占用，并启动前端和后端服务。

也可以在命令行中手动启动：

```bash
npm install
npm run dev
```

## 访问地址

启动成功后，在浏览器打开：

```text
http://localhost:5173
```

后端健康检查地址：

```text
http://localhost:8787/api/health
```

如果页面提示后端服务未启动，请重新运行 `start.bat`。
