# Java 示例插件（SDK v2）

插件 ID：`java-example`；版本：`1.0.0`。Java 21、Spring Boot 4.1.1、Maven，独立 HTTP 服务，仅支持 **external** 部署。工程不依赖数据库、Redis、用户目录或其他插件。

实现三个 control 扩展点，均在 AI Hub **master** 节点生效：

| 扩展点 | 实现 | 可见效果 |
| --- | --- | --- |
| `site.navigation` | 前端 `topNavigation(profile)`、`Page` | 首页、控制台顶部及移动菜单中的“Java 示例”入口 |
| `user.identity.enrich` | `/internal/profile`、`/internal/bootstrap` | 宿主当前用户响应中的 `data.extensions["java-example"]` |
| `user.profile.card` | 前端 `ProfileCard({profile})` | 个人资料抽屉及快捷面板中的 Java 身份卡片 |

最低宿主要求：支持 [SDK v2 规范 1.4](https://github.com/blueskyxi3/ai-hub/blob/main/.req/plugins/plugin-development-standard-sdk-v2.md) 的三个扩展点、`/api/plugin-bridge/:id/*` 和内部运行配置协议。以 AI Hub 仓库 `3e94e4f28` 及当前协议实现为兼容基线，不使用旧 `/api/plugins/:id/*` 代理地址。

**前端源码统一在 `web/`，支持 JSX 与拆分组件。**进入 `web/` 执行 `npm ci`、`npm run dev:mock`，即可脱离 AI Hub 调界面；`npm run dev` 连接真实 Java，`npm run dev:hub` 监听构建供 AI Hub 联调。具体操作见 [前端开发与联调](web/README.md)。

## 1. Docker Compose 启动

```sh
cd java-plugin-example
cp .env.example .env
openssl rand -hex 32
```

将生成的随机值填写到 `.env` 的 `JAVA_EXAMPLE_HOST_SECRET`。安装时在宿主 AI Hub 的“通信密钥 Secret”输入框填写同一值；也可预先通过插件目录的 `secret` 或 `secret_env` 配置宿主凭据，安装时留空沿用。Compose 的 `.env` 只供本工程读取，不会设置宿主环境变量。

```sh
docker compose up --build -d
docker compose ps
curl --fail http://127.0.0.1:3013/healthz
```

默认映射宿主 `127.0.0.1:3013` → 插件容器 `8080`。Docker 多阶段构建先执行前端 `npm test`（含生产构建），再执行 `mvn verify`，将清单及 `web/build/assets/plugin.js` 打入 JAR；运行容器使用 UID/GID `10001`，运行配置保存在命名卷的 `/app/data/runtime.json`。

部署配置只传给插件进程，不随插件前端发布。共享密钥缺失、少于 32 字符或插件 ID 与清单不一致时，启动失败。安装表单中的通信密钥仅提交给宿主安装接口，不回填到浏览器或写入插件目录。

## 2. 地址与环境配置

| 配置 | 默认值 | 用途 |
| --- | --- | --- |
| `JAVA_EXAMPLE_HOST_SECRET` | 必填 | 宿主和插件配对密钥 |
| `JAVA_EXAMPLE_PLUGIN_ID` | `java-example` | 启动时必须与清单一致 |
| `JAVA_EXAMPLE_SERVER_PORT` | `8080` | 插件服务端口；Compose 内固定为 8080 |
| `JAVA_EXAMPLE_PUBLISHED_PORT` | `3013` | 仅 Compose 使用的本机映射端口 |
| `JAVA_EXAMPLE_DATA_DIR` | JAR：`./data`；容器：`/app/data` | 可写、持久化的运行配置目录 |
| `JAVA_EXAMPLE_HOST_BASE_URL` | 空 | 可选启动覆盖；为空时读取持久化配置，再回退到 `http://localhost:3000` |

宿主注册字段 `url` 是 **宿主 → 插件**，`host_url` 是 **插件 → 宿主**；均填写 HTTP/HTTPS origin，允许端口和末尾 `/`，不含业务路径、查询、片段或用户名密码。

| 部署情况 | 注册 `url` | 注册 `host_url` |
| --- | --- | --- |
| macOS/Windows 本机运行 AI Hub，插件使用默认 Compose | `http://127.0.0.1:3013` | `http://host.docker.internal:3000` |
| AI Hub 和插件在同一 Docker 网络 | `http://java-example:8080` | `http://ai-hub:3000`（替换为实际宿主服务名） |
| 不同服务器 | 插件内网或 HTTPS 服务 origin | 插件网络可达的宿主 origin |

同一 Docker 网络示例：先创建网络 `docker network create ai-hub-plugins`，将现有宿主容器连接到该网络并设置别名 `ai-hub`，再将本例的 Compose 服务加入该外部网络：

```yaml
services:
  java-example:
    networks: [ai-hub-plugins]
networks:
  ai-hub-plugins:
    external: true
```

容器之间通过网络访问，不使用映射端口。Linux 本机宿主可为插件容器增加 `extra_hosts: ["host.docker.internal:host-gateway"]`，并确保 AI Hub 监听容器可达的地址。

本例不实际调用宿主业务 API，但完整实现回调配置协议，便于添加业务调用时复用。不要将 `X-AIHub-Identity` 或插件共享密钥用作宿主用户 API 的 Bearer 凭证；这类调用须按规范使用当前请求的 `X-AIHub-Host-Authorization`。

## 3. 登记与启用

1. 确认 AI Hub master 已运行并启用扩展管理，Java 插件已配置 `JAVA_EXAMPLE_HOST_SECRET` 并启动。
2. 以有扩展管理权限的 root 用户进入“扩展管理 → 插件目录”，使用 `catalog.example.json` 的内容登记目录。将 `external_url` 改为宿主实际可达的插件 origin。`secret_env` 在**宿主进程**读取，目录不保存真实密钥。
3. 在插件市场选择“Java 示例”，申请试用并选择 **external**。填写正确的插件 URL、宿主回调 URL，以及与插件一致的“通信密钥 Secret”，不申请任何 `service_capabilities`。密钥非空时优先于目录配置，仅保存到本次安装记录；留空时沿用目录配置（配置了 `secret_env` 时读取宿主环境变量，否则使用目录 `secret`）。输入无效时安装失败，不自动回退。目录默认试用 7 天，后续授权遵循宿主市场规则。
4. 安装会验证受保护的 `/internal/manifest`，并调用 `/internal/bootstrap`。运行状态应为 `active`。
5. 登录用户刷新活动插件后，检查顶部“Java 示例”、页面中的后端身份验证结果，以及个人资料抽屉/快捷面板的卡片。单纯登记目录不代表已安装或启用。

也可使用宿主现有接口登记目录：`POST /api/extensions/catalog`，请求体就是目录 JSON。该操作要求 root 与扩展管理权限；请通过已认证管理会话执行，不将管理员凭据写入本工程。

## 4. 协议与授权边界

| 插件接口 | 认证 | 响应 |
| --- | --- | --- |
| `GET /healthz` | 无 | `{"status":"ok"}` |
| `GET /assets/plugin.js` | 无 | 原生 ES module |
| `GET /internal/manifest` | 共享密钥 | 完整清单，直接 JSON |
| `POST /internal/profile` | 共享密钥 | 接收 `{"user_id":123}`，直接返回资料 |
| `POST /internal/bootstrap` | 共享密钥 | 校验正整数 ID，幂等成功响应 |
| `GET/PUT /internal/runtime` | 共享密钥 | `{"host_url":"https://hub.example"}` |
| `GET /api/v1/self` | `X-AIHub-Identity` | `{"success":true,"message":"","data":{...}}` |

资料为：

```json
{
  "user_id": 123,
  "active": true,
  "module_admin": false,
  "demo_role": "member",
  "source": "spring-boot"
}
```

这是面向宿主已认证用户的演示资料，不复制宿主用户状态，不授予宿主或插件管理员权限，不返回 `module_permissions`，不新增模块登录权限。`bootstrap` 不保存用户、角色或初始化标记。

浏览器仅访问宿主 `/api/plugin-bridge/java-example/api/v1/self`，插件前端从 SDK `getPluginBases("java-example").apiBase` 取地址；其值已包含 `/api/v1`。前端不设置服务密钥或身份签名。

插件验签采用两个无填充 base64url 片段、HMAC-SHA256 和常量时间比较，绑定插件 ID、正整数用户 ID、方法、原始 URI 与查询字符串，以及 `0 < expires_at - now <= 60`。请求中的 `user_id` 参数不改变当前用户。协议不包含 Body 摘要或一次性 request ID 去重。

所有 `/internal/*` 都先验证 `X-AIHub-Plugin-Secret`，再处理业务与回调地址同步；不通过公开代理访问。生产网络或反向代理应限制该路径仅供宿主使用。浏览器的登录、插件启用及用户状态检查由宿主执行。

## 5. 运行配置与多实例

宿主运行信息弹窗调用 `GET/PUT /internal/runtime`。GET 返回当前值，不自行覆盖配置；PUT 和认证内部请求中的 `X-AIHub-Host-Base-URL` 会先写临时文件、原子替换 `runtime.json`，成功后发布内存值。无写权限或保存失败返回错误，旧内存值保留。

启动优先级：非空 `JAVA_EXAMPLE_HOST_BASE_URL` > `data/runtime.json` > `http://localhost:3000`。希望运行时修改在重启后保留时，保持该环境变量为空；非空环境变量会在每次启动覆盖持久化值。运行中仍可被宿主认证请求更新。

external 多实例使用统一负载均衡入口、相同配对密钥及 master 回调地址，每个实例配独立可写持久卷。一次 PUT 只更新命中的实例，其余实例通过认证内部请求逐步同步，宿主不提供所有副本的即时原子更新。

## 6. 本机 Maven / JAR

已安装 Node.js 20.19+（20.x）或 22.12+、Java 21 和 Maven 3.6.3+ 时：

```sh
cd java-plugin-example
cd web
npm ci
npm run build
cd ..
mvn -B verify
export JAVA_EXAMPLE_HOST_SECRET='<与宿主相同的至少32字符随机密钥>'
java -jar target/java-example-1.0.0.jar
```

前端构建完成后，无需本机 Java/Maven 的 Maven 构建：

```sh
docker run --rm \
  --mount type=bind,src="$PWD",dst=/build \
  --mount type=volume,src=ai-hub-java-example-maven,dst=/root/.m2 \
  -w /build maven:3.9.11-eclipse-temurin-21 mvn -B verify
```

构建出的 JAR 也可复制到已有 Java 21 服务器运行。前端从 `web/src/plugin.jsx` 构建，使用宿主 React/MUI，不内嵌第二份 React。仅构建插件入口，不打包 `web/index.html` 或独立调试工具栏；新增页面可以放在 `web/src/pages/` 并从插件入口导入。

## 7. 验证

`web/` 中 `npm test` 验证前端生产模块与本地代理；先构建前端后，`mvn verify` 验证身份协议、真实随机端口 HTTP、清单与静态模块一致性和运行配置。HTTP 测试使用隔离临时目录，不访问宿主数据库。Go 签名样本由本仓库真实 `extensions.Sign` 生成，固定测试密钥不用于部署。

在同级 `ai-hub` 目录重新生成样本：

```sh
go run ../java-plugin-example/scripts/go-sign-fixture.go \
  > ../java-plugin-example/src/test/resources/go-sign-fixture.json
```

运行 Java 服务后，在同级 `ai-hub` 目录验证真实 Go Runtime 的 external 注册、清单校验、bootstrap、身份扩展、Go 签名请求、宿主公开桥接与内部路径隔离、回调更新、注册恢复和停用：

```sh
export JAVA_EXAMPLE_HOST_SECRET='<测试服务的配对密钥>'
export JAVA_EXAMPLE_TEST_URL=http://127.0.0.1:3013
go run ../java-plugin-example/scripts/host-smoke.go
```

该命令使用临时注册文件，不修改已安装宿主的注册表或数据库。桥接验证使用真实宿主处理函数，并以固定的已认证用户 context 替代登录中间件，不验证登录流程。它会将**目标测试插件**的回调地址更新为演示地址，只应指向独立测试实例。

宿主界面联调还需检查：登录后的顶部/移动入口、资料卡片、页面 API 成功与重试、四种语言和深浅主题、未知子路径、退出登录与停用后的撤回，以及公开桥接请求 `/internal/manifest` 返回禁止访问。该部分需要真实已认证宿主环境，不能由后端协议测试替代。

## 8. 升级与回滚

更新版本时同步 `pom.xml`、`plugin.json`、`catalog.example.json` 和镜像标签；清单必须完整相等。前端和清单随同一 JAR 发布。先备份宿主注册表、目录配置和运行配置卷，再在隔离环境验证新镜像及完整清单。

升级时暂停插件流量，替换 external 服务镜像，再更新宿主目录并通过市场升级，使注册清单与运行清单同步。不要仅替换服务后继续使用旧清单。

本版本无业务数据库迁移，运行配置只有 `host_url`。回滚时恢复旧镜像、对应清单/目录及必要的配置备份，再验证状态、代理请求和卡片；保留配对密钥和命名卷。`docker compose down` 保留卷，勿用 `down -v` 清理要保留的配置。

## 9. 目录说明

`web/src/plugin.jsx` 是前端业务入口，`web/src/main.jsx` 是独立调试入口；构建产物在忽略提交的 `web/build/`。Java 源码及配置位于 `src/`，清单唯一源文件为根目录 `plugin.json`。`scripts/` 中的 Go 文件仅用于跨语言协议验证，不参与 JAR 或运行镜像。
