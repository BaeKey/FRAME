# FRAME

FRAME 是一个面向 OpenList 的私人媒体库：从指定目录读取加密媒体文件的索引，在浏览器中浏览、筛选、预览和管理内容。媒体解密在浏览器端完成；网关只提供认证、目录索引和媒体源地址，不代理媒体文件内容。

## 功能

- 从 OpenList 指定目录构建媒体索引，按需刷新并持久化索引状态。
- 按分组浏览图片与视频，支持搜索、类型筛选和时间排序。
- 浏览器端解密 `OLAES1` 文件，并支持图片预览和视频 Range 流式播放。
- 管理命名规则、批量删除文件，并查看或重试未完成的删除任务。
- 访问令牌登录、HttpOnly 会话 Cookie 与可配置的浏览器密钥会话周期。

## 工作方式与前置条件

1. OpenList 中需有 FRAME 可访问的登录账号，以及存放**原始加密文件**的目录。
2. 加密文件必须是 FRAME 前端支持的 `OLAES1` 格式，并使用与加密端一致的 AESCTR 驱动、密码和盐；Argon2 参数也必须匹配。
3. OpenList 返回的每个文件 `raw_url` 必须能由访问者的浏览器直接访问。媒体源站/CDN需允许来自 FRAME 站点的跨域请求；视频还需支持 HTTP Range。
4. 浏览器直接从媒体源站/CDN读取媒体，**FRAME 网关不代理媒体流量**。因此，网关主机本身通常不需要能下载媒体直链，但用户浏览器必须能访问它们。

## 快速开始（本地）

要求：Go 1.22 或更高版本、Node.js 20 或更高版本、npm。

```sh
cp config.example.yaml config.yaml
```

编辑 `config.yaml`，至少填写 `server.access_token`、`openlist` 凭据与目录、以及 `crypt` 参数。访问令牌至少 32 字节；可用以下命令生成随机值：

```sh
openssl rand -hex 32
```

构建前端并启动网关：

```sh
npm ci --prefix web
npm run build --prefix web
go run ./cmd/gateway -config config.yaml
```

默认监听 `127.0.0.1:8080`，然后在本机浏览器打开 <http://127.0.0.1:8080>，用 `server.access_token` 登录。若希望直接在 Go 命令中运行而不是 `go run`，先构建：

```sh
go build -o bin/frame ./cmd/gateway
./bin/frame -config config.yaml
```

文件索引、登录会话和待处理删除任务都保存在进程内存中；服务重启后会重新从 OpenList 扫描并要求重新登录，尚未完成的删除重试记录不会保留。命名规则从配置文件读取。

## 开发与测试

开发模式需要同时运行 Go 网关和 Vite：先按[快速开始](#快速开始本地)构建一次前端并启动网关，再在另一终端运行：

```sh
npm ci --prefix web
npm run dev --prefix web
```

打开 Vite 输出的本地地址（通常为 <http://localhost:5173>）；`web/vite.config.ts` 会将 API 请求代理到 `127.0.0.1:8080`。改动前端后可直接热更新。

生产/嵌入式构建时，先生成前端产物，再运行 Go 网关：

```sh
npm run build --prefix web
go run ./cmd/gateway -config config.yaml
```

运行测试：

```sh
go vet ./...
go test ./...
npm test --prefix web
npm run build --prefix web
```

`web` 的 Vite 构建产物会嵌入 Go 二进制；因此运行网关前必须先生成 `web/dist`。

## Docker

在项目根目录构建镜像：

```sh
docker build -t frame:local .
```

运行时只需提供配置文件：

```sh
docker run --name frame \
  -p 127.0.0.1:8080:8080 \
  -v "$PWD/config.yaml:/app/config.yaml:ro" \
  frame:local
```

容器内默认读取 `/app/config.yaml`。容器部署时，将 `server.listen` 设为 `0.0.0.0:8080`，并通过反向代理提供 HTTPS；不要把网关 HTTP 端口直接暴露到公网。示例配置中的 `127.0.0.1:8080` 适用于本机运行，不适用于容器内监听。

## 配置说明

完整字段及注释见 [`config.example.yaml`](config.example.yaml)。主要配置项：

| 配置 | 用途 |
| --- | --- |
| `server.listen` | 网关监听地址和端口 |
| `server.access_token` | 用户登录访问令牌，至少 32 字节 |
| `openlist.base_url`、`username`、`password` | OpenList 地址和登录凭据 |
| `openlist.cipher_backend_path` | OpenList 内原始密文目录的绝对路径，不能指向已解密挂载 |
| `crypt.password`、`salt_base64` | 与加密端一致的解密密码和 Base64 盐 |
| `crypt.argon2.*` | 密钥派生参数；必须与生成媒体文件时的参数一致 |
| `session.key_ttl_seconds` | 浏览器内存中的解密密钥会话有效期，不是登录 Cookie 有效期 |
| `index.check_interval_seconds` | 导航时检查内存索引变化的间隔；不是后台周期扫描定时器 |
| `index.naming_rules` | 分组命名规则；修改配置后需重启服务生效 |
| `logging.level` | 日志级别：`error`、`info` 或 `debug` |

## 安全提示

- `config.yaml` 含 OpenList 凭据、访问令牌和解密秘密；不要提交、公开或放进镜像。该文件已由 `.gitignore` 忽略。
- 使用 HTTPS 反向代理对外服务，并限制网关端口只允许可信代理访问。不要信任未经验证的公网转发头。
- 访问令牌与 OpenList 登录凭据是不同凭据；登录页面使用 `server.access_token`。
- 媒体在浏览器中解密，但浏览器最终会接触解密后的内容。仅在可信设备和浏览器中使用，并妥善保护设备与 OpenList 账号。
- 文件索引、会话和待完成删除任务仅存在内存中；重启后会重建索引、重新登录，且未完成删除任务无法恢复。
