# 部署指南

## 桌面客户端分发

### Windows 安装包

1. 构建 MSI 安装包

```bash
cd src-tauri
cargo tauri build
```

2. 产物位置：`src-tauri/target/release/bundle/msi/`

3. 可选：使用 Inno Setup 制作更友好的安装程序

### Linux AppImage

1. 构建 AppImage

```bash
cd src-tauri
cargo tauri build
```

2. 产物位置：`src-tauri/target/release/bundle/appimage/`

3. 分发前测试

```bash
chmod +x DSH-PluginUpdater_*.AppImage
./DSH-PluginUpdater_*.AppImage
```

## 官方网站部署

### 方案一：Node.js 服务器

```bash
cd website
npm install
npm run build

# 使用 PM2 管理进程
npm install -g pm2
pm2 start .output/server/index.mjs --name dsh-website
pm2 save
pm2 startup
```

### 方案二：静态站点托管

```bash
cd website
npm run generate
# 产物在 .output/public/
# 上传到 Vercel / Netlify / Cloudflare Pages 等托管平台
```

### Nginx 配置（Node.js 模式）

```nginx
server {
    listen 443 ssl http2;
    server_name dsh.huilinsh.cn www.dsh.huilinsh.cn;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 静态资源缓存
    location /_nuxt/ {
        proxy_pass http://127.0.0.1:3000;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

## 域名与 DNS 配置

| 域名 | 用途 |
|------|------|
| `dsh.huilinsh.cn` | 官方网站 |

### DNS 配置示例

```
A       dsh.huilinsh.cn    <网站服务器IP>
CNAME   www.dsh.huilinsh.cn    dsh.huilinsh.cn
```

## 监控与维护

### 网站监控

```bash
# 查看服务状态
pm2 status

# 查看日志
pm2 logs dsh-website --lines 100

# 重启服务
pm2 restart dsh-website
```

## 安全建议

1. **启用 HTTPS**：所有通信加密传输
2. **定期更新**：保持依赖和镜像最新
3. **防火墙配置**：只开放必要端口（80, 443, 22）

## 故障排查

### 服务无法启动

```bash
# 查看详细日志
pm2 logs dsh-website --lines 50

# 检查端口占用
sudo netstat -tlnp | grep 3000
```
