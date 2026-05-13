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

Linux/macOS 用户可以运行：

```bash
chmod +x start.sh
./start.sh
```

脚本同样会检查默认端口，并启动前端和后端开发服务。

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

## Docker 部署

请先准备 `.env` 文件：

```bash
cp .env.example .env
```

然后编辑 `.env`，至少配置：

```text
PANGHU_API_BASE_URL=你的胖狐 API 地址
PANGHU_API_KEY=你的胖狐 API Key
ADMIN_USERNAME=管理员账号
ADMIN_PASSWORD=管理员密码
SESSION_SECRET=一段足够长的随机字符串
API_PORT=8787
```

构建镜像：

```bash
docker build -t panghu-image-web .
```

启动容器：

```bash
docker run -d \
  --name panghu-image-web \
  --env-file .env \
  -p 8787:8787 \
  -v "$(pwd)/data:/app/data" \
  -v "$(pwd)/logs:/app/logs" \
  panghu-image-web
```

Docker 模式下前端由后端服务直接托管，访问：

```text
http://localhost:8787
```

管理员后台：

```text
http://localhost:8787/admin
```

查看日志：

```bash
docker logs -f panghu-image-web
```

停止并删除容器：

```bash
docker rm -f panghu-image-web
```

`data/` 目录会保存 SQLite 数据库和本地缓存图片，`logs/` 目录会保存服务日志。部署时建议始终挂载这两个目录，避免容器重建后数据丢失。
