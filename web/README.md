# 前端开发与联调

前端统一放在 `web/`，独立预览和 AI Hub 使用同一份插件源码。需要 Node.js 20.19+（20.x）或 22.12+，推荐 Node 24；npm 依赖独立于 AI Hub 的 `web/`。

```text
web/
├── src/plugin.jsx   插件入口：Page、ProfileCard、topNavigation
├── src/main.jsx     独立预览入口：安装模拟 SDK、语言/主题工具栏
├── index.html       独立预览 HTML，加载 main.jsx
├── server.mjs       本地模拟资料、代理和签名，只在开发服务器运行
├── vite.config.mjs  独立预览与插件构建配置
├── compose.yaml     独立 Java 调试容器，挂载 build/，开放 JDWP
└── build/assets/    构建产物：plugin.js，可由 Java/AI Hub 加载
```

`main.jsx` 先准备 `window.AIHubPluginSDK`，再加载 `plugin.jsx`。在 AI Hub 中，宿主提供 SDK 并直接加载构建后的 `plugin.js`，不使用独立预览 HTML、工具栏或模拟用户。业务组件始终使用 SDK 的 React、MUI、API 和国际化能力。

首次在插件根目录执行：

```sh
cd web
npm ci
```

## 1. 独立调界面：不启动 Java、Docker 或 AI Hub

```sh
npm run dev:mock
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)，会进入 `/plugins/java-example`。用户资料和 `/self` 使用模拟数据，默认用户 ID 为 `123`；其他 API 返回未模拟提示。

修改 `src/plugin.jsx` 或它导入的组件，保存后页面自动刷新，支持直接写 JSX。按 F12 打开开发者工具，在 Sources 中找到源文件打断点，在 Network 查看请求。工具栏可切换四种语言、深浅主题、无效资料；左侧预览资料卡片，右侧预览页面。

输入子路径可验证多页面分发。当前示例只实现首页，`users` 等子路径显示“页面不存在”。刷新子路径也能进入预览。

## 2. 独立调真实接口：前端 + Spring Boot

先准备插件根目录 `.env`。已有配置直接使用；没有时：

```sh
cd ..
cp -n .env.example .env
openssl rand -hex 32
```

把生成的随机值填入 `.env` 的 `JAVA_EXAMPLE_HOST_SECRET`，然后：

```sh
cd web
npm run backend:up
npm run dev
```

如 `dev:mock` 仍占用 5173，先 Ctrl+C 停止它。浏览器仍打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)，工具栏显示“真实后端联调”。

```text
浏览器 :5173 → Vite 开发代理（模拟用户、生成签名）→ Java :3014
```

开发服务器从 Java `/internal/profile` 取得资料，并为业务 API 签名。共享密钥留在 Node/Java 进程中，后端保持真实验签；浏览器不接收密钥。直接请求 Java `/api/v1/self` 而不带签名仍返回 401。

```sh
curl --fail http://127.0.0.1:5173/api/plugin-bridge/java-example/api/v1/self
npm run backend:logs
# 修改 Java 代码后重建；只改前端源码不需要运行：
npm run backend:up
# 结束开发（保留数据卷）：
npm run backend:down
```

调试容器监听本机 `3014`，使用独立数据卷，不影响普通安装服务的 `3013`。Vite、Java 映射端口及 JDWP 均绑定本机 loopback。

## 3. 与真实 AI Hub 联调

使用相同的 Java 调试容器，再启动监听构建：

```sh
npm run backend:up
npm run dev:hub
```

`dev:hub` 将源码构建为 `build/assets/plugin.js`，持续监听变更，并生成 source map；Java 容器已挂载该目录，优先提供磁盘上的构建产物。它不启动 5173，也不自动刷新 AI Hub 页面。

在本机运行 AI Hub 时，按[插件安装指南](../README.md#3-登记与启用)登记并安装测试插件：

| 设置 | 填写 |
| --- | --- |
| 部署方式 | `external` |
| 插件 URL / 目录 `external_url` | `http://127.0.0.1:3014` |
| 宿主回调 `host_url` | `http://host.docker.internal:3000`（插件在 Docker 中） |
| 宿主 `secret_env` | `JAVA_EXAMPLE_HOST_SECRET`，值与插件根目录 `.env` 一致 |

已有 `3013` 安装时，宿主注册的目标也必须切到 `3014` 才会加载此调试容器；单独启动监听构建不会改变已有安装。测试结束按原安装配置切回 `3013`。请使用测试宿主及账号联调。

打开 [http://localhost:3000/plugins/java-example](http://localhost:3000/plugins/java-example)：

1. 修改 `src/plugin.jsx` 或导入组件，等待终端显示构建完成。
2. 刷新 AI Hub 页面。开发者工具 Network 可勾选 Disable cache；宿主的模块缓存也需要整页刷新。
3. 在 Sources 中通过 source map 找到 `src/plugin.jsx` 打断点。
4. 在真实宿主验证顶部入口、个人资料卡片、语言、主题、登录状态及停用行为。此时 API 经过真实宿主代理签名，用户来自登录账号，`JAVA_EXAMPLE_DEV_USER_ID` 不生效。

```text
web/src/plugin.jsx → Vite 监听构建 → web/build/assets/plugin.js
                                      ↓ 挂载
浏览器 :3000 → AI Hub 代理/真实 SDK → Java :3014
```

若 AI Hub 也运行在容器内，`127.0.0.1:3014` 指向的是宿主容器自身。应将宿主加入调试 Compose 网络：

```sh
docker network connect java-example-dev_default <AI-Hub容器名>
```

插件 URL 改为 `http://java-example-dev:8080`；回调地址填写插件容器可达的 AI Hub origin。回调使用容器名时，还需让该名称在共享网络可解析。Linux 本机宿主的 host-gateway 配置见根目录 README。

## 4. Java 断点

Docker 调试容器已开启 JDWP，映射本机 `5005`。在 IDEA 打开插件根目录 `pom.xml`，使用 Java 21，创建 **Remote JVM Debug**，Attach 到 `127.0.0.1:5005`。在 `PluginController.self()` 打断点，点击页面“重新验证”即可进入。

修改 Java 源码后运行 `npm run backend:up`，确保容器字节码和 IDE 源码一致。身份验证之前停留超过 30 秒可能导致凭证过期，恢复后重新发请求即可。

本机已安装 Java 21/Maven 时，也可在插件根目录直接 Debug `PluginApplication`，Working directory 设为插件根目录，环境变量设置为：

```dotenv
JAVA_EXAMPLE_HOST_SECRET=与插件根目录.env相同的随机密钥
JAVA_EXAMPLE_SERVER_PORT=3014
JAVA_EXAMPLE_DATA_DIR=./data/dev
SPRING_WEB_RESOURCES_STATIC_LOCATIONS=file:./web/build/assets/,classpath:/assets/
```

首次先在 `web/` 执行 `npm run build`。之后用 `npm run dev` 独立调接口，或用 `npm run dev:hub` 配合 AI Hub。IDEA 直接 Debug 无需 Attach；Docker 与 IDEA 后端选一种，避免端口冲突。

## 5. 多页面与发布构建

可以在 `src/pages/` 下拆分多个 `.jsx` 文件，由 `src/plugin.jsx` 导入，`Page({profile,path})` 根据 `path` 分发。组件中的 React/MUI 从宿主 SDK 获取，例如：

```jsx
// src/pages/Users.jsx
const { React, MUI } = window.AIHubPluginSDK;
export default function Users({ profile }) {
  return <MUI.Typography>当前用户：{profile.user_id}</MUI.Typography>;
}
```

插件入口导入后使用 `<Users profile={profile} />` 即可。默认静态导入会合并到入口产物；不需要为每个页面提供一个独立 HTML，也不要为业务模块导入另一份 React。

```sh
npm run build
```

生产构建输出 `build/assets/plugin.js`，不包含独立预览壳或其 npm SDK。Maven 将整个 `build/` 放入 JAR。根目录 `docker compose up --build -d` 会自动执行前端测试/构建及 Maven 验证；本机运行 Maven 前须先执行前端构建。生产容器使用 JAR 内资源，不挂载本地源码。

## 6. 配置与检查

下列可选变量放在插件根目录 `.env`，修改后重启 Vite；Docker 端口改变后重新运行 `backend:up`。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `JAVA_EXAMPLE_DEV_PORT` | `5173` | 独立预览端口 |
| `JAVA_EXAMPLE_DEV_USER_ID` | `123` | 独立预览签发的模拟用户 ID |
| `JAVA_EXAMPLE_DEV_BACKEND_PORT` | `3014` | 调试容器映射端口及默认代理目标端口 |
| `JAVA_EXAMPLE_DEV_BACKEND_URL` | `http://127.0.0.1:3014` | 可覆盖为已有插件后端 |
| `JAVA_EXAMPLE_DEV_DEBUG_PORT` | `5005` | Java 远程调试端口 |

```sh
npm test
```

测试包括构建后 ES module 的三个扩展导出、真实 React/MUI 渲染、失效资料与语言、生产包隔离，以及代理签名、原始 URI、凭据清理、密钥隔离和非法路径。

“无法读取插件资料”时检查 Java 健康状态、代理目标及配对密钥。AI Hub 中前端没更新时，检查注册的插件 URL 是否为 3014、监听构建是否运行，并整页刷新浏览器。真实登录、市场授权和账号状态仍需在 AI Hub 验收。

本次验证（2026-10-22）：前端 7 项测试、Java 14 项测试及 Docker 构建通过；Chromium 验证独立模拟、真实 Java API、语言/主题、移动布局和源码刷新通过；监听构建、挂载资源更新、source map、JDWP 握手及真实 Go Runtime/桥接协议通过。未操作现有 AI Hub 的目录登记、安装或登录会话。
