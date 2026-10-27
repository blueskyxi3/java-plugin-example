# AI Hub 插件开发规范（SDK v2）

版本：1.5。更新日期：2026-10-23。

适用范围：接入 AI Hub 当前通用插件体系的独立 HTTP 服务，支持 process 和 external 部署。以当前 organization 和 feedback 实现为参考，不适用于旧 Go `.so` 插件。

本文中的“必须”是接入要求，“建议”是工程建议。示例统一使用 `example` 作为插件标识，新插件应替换为自己的唯一标识。

完整实现样例见 [SDK v2 扩展点样例目录](sdk-v2-examples/README.md)：前端提供 React、Vue、原生 HTML 三套实现，后端提供 Go、Java 两套独立 HTTP 服务。第 15 节列出各扩展点对应的代码与运行入口。

## 1. 系统边界

| 参与方 | 职责 |
| --- | --- |
| 宿主主程序 | 注册与授权、进程管理、通用反向代理、身份签发、宿主 REST 资源鉴权 |
| 插件后端 | 插件业务、数据模型、业务权限、流程编排、宿主资源调用及失败处理 |
| 插件前端 | 插件页面和交互，通过宿主入口访问插件 API |

请求链路：

```text
浏览器 → 宿主 /api/plugin-bridge/example/api/v1/tasks
       → example 服务 /api/v1/tasks
       → 必要时以当前用户委托身份访问宿主标准 REST API
```

必须遵守以下边界：

- 插件独立提供 HTTP 接口，不导入宿主 controller/model 来执行宿主业务，不直接读写宿主业务表。
- 宿主代理不增加按插件名称分支的业务处理函数。
- 如现有宿主接口缺少能力，应设计通用资源 REST API，按宿主原权限接入，不建立某插件专用的宿主业务桥接。
- 插件自身权限由插件后端执行；涉及宿主资源时，宿主再执行原有用户权限。
- 浏览器不获得插件共享密钥，也不获得宿主内部的用户委托凭证。

## 2. 插件标识与清单

### 2.1 标识规则

`plugin.json.id` 是插件唯一标识及代理路由键，符合：

```regex
^[a-z][a-z0-9_-]{0,63}$
```

标识必须与服务返回的清单、注册记录、进程配置一致。注册后升级沿用原标识；显示名称可变更。变更标识视为安装新插件，不自动迁移数据和权限。

### 2.2 最小页面插件清单

```json
{
  "id": "example",
  "name": "示例模块",
  "version": "1.0.0",
  "sdk_version": 2,
  "extensions": ["console.navigation"],
  "entry": "/assets/plugin.js"
}
```

清单字段要求：

| 字段 | 要求 |
| --- | --- |
| `id` | 唯一且符合标识规则 |
| `name` | 非空显示名称 |
| `version` | 使用语义化版本，升级递增 |
| `sdk_version` | 当前新插件必须为 `2` |
| `extensions` | 只声明实际使用的已支持扩展点，不重复声明 |
| `entry` | 当前固定为 `/assets/plugin.js` |
| `backend` | 可选，可执行文件名；省略时使用 `id`，不能包含目录 |
| `navigation` | 可选，清单中的 `group`、`before` 使用大写字母分组名称 |
| `storage_directory` | 使用 `storage.objects` 时必填有效子目录名；否则不填写 |

安装包中的清单与 `/internal/manifest` 返回的清单必须一致，不能只比较 `id` 和版本。可将同一份 `plugin.json` 嵌入可执行文件，避免两份清单漂移。

### 2.3 扩展点的平面归属

平面属于宿主开放的扩展点。宿主的每个 `Point` 必须标注 `plane: control`（master）或 `plane: data`（slave）；插件清单仅声明扩展点 ID，不声明 `manifest.plane`，也不能覆盖宿主的平面定义。

一个插件可以同时实现 control 和 data 扩展点。只要至少一个扩展点匹配当前节点，插件就适用于该节点；宿主仅调用其中匹配的扩展点，也仅向活动插件前端暴露匹配的扩展点。不匹配的身份扩展不触发控制平面初始化。未声明任何扩展点的历史插件保持仅在 master 生效。

扩展点管理界面展示平面与本节点的生效情况，插件目录的扩展点选择项也展示平面。目前开放七个 control 扩展点，以及 `relay.request.intercept` 和 `relay.response.intercept` 两个 data 扩展点。组织架构和问题反馈在 master 生效；example 的导航在 master 生效，模型拦截在 slave 生效。完整演示要求两个节点连接同一个 external 服务。

历史 JSON 中的 `manifest.plane` 被忽略，重新保存时移除；修改该字段不能改变插件在哪个节点生效。部署模式还须满足第 10.1 节的限制。

## 3. 后端接口契约

### 3.1 路由分类

| 插件服务路由 | 是否经公开代理访问 | 要求 |
| --- | --- | --- |
| `/api/v1/*` | 是 | 验证宿主签发的请求身份，并执行业务权限 |
| `/assets/*` | 是 | 提供前端入口与资源，不包含密钥或私有配置 |
| `GET /internal/manifest` | 否 | 接入必需，验证服务共享密钥，直接返回清单 JSON |
| 其他 `/internal/*` | 否 | 按扩展点实现，验证服务共享密钥 |
| `GET /healthz` | 否 | 建议提供，用于运维健康检查 |

宿主公开入口为：

```text
/api/plugin-bridge/{plugin_id}/api/v1/*
/api/plugin-bridge/{plugin_id}/assets/*
```

`/api/plugin-bridge/{plugin_id}/*` 是唯一插件公开代理入口。旧 `/api/plugins/{plugin_id}/*` 已移除，不再代理或重定向，请求返回 404；已有插件、外部调用方及部署配置中的旧地址必须迁移。

宿主剥离 `/api/plugin-bridge/{plugin_id}` 前缀后保留 HTTP 方法、查询参数（含重复参数和编码值）及请求体，转发到注册的插件服务。例如 `PATCH /api/plugin-bridge/example/api/v1/tasks/123?tag=a%2Fb&tag=two` 转发为插件的 `PATCH /api/v1/tasks/123?tag=a%2Fb&tag=two`。插件内部路由不包含 `/api/plugin-bridge/example`。

`GET /api/plugins` 是活动插件列表接口，继续保留；它返回各插件的 `api_base` 和 `asset_base`，与已移除的带插件 ID 的代理路径不同。宿主页面路由 `/plugins/{plugin_id}/*`、`/panel/plugins/{plugin_id}/*` 继续用于展示插件页面，不是后端代理入口。

当前宿主启用插件时检查的是受保护的 `/internal/manifest` 及清单一致性，不能以为提供 `/healthz` 即可通过安装。

### 3.2 响应与错误

插件业务 JSON API 采用：

```json
{"success": true, "message": "", "data": {"id": 123}}
```

```json
{"success": false, "message": "无权修改该资源", "code": "permission_denied"}
```

推荐使用准确的 HTTP 状态：参数错误 400、身份无效 401、权限不足 403、资源不存在 404、冲突 409、内部错误 500。静态资源、下载等使用对应原始响应格式。

调用宿主时同时检查 HTTP 状态和 `success`；宿主部分原生接口会在 HTTP 200 下返回 `success:false`，不能将其当作业务成功。不得把包含凭据、完整请求 Header 或内部连接信息的错误直接展示给用户。

## 4. 鉴权协议

先按调用方向选择凭证，不要混用：

| 调用场景 | 凭证 | 谁负责验证 |
| --- | --- | --- |
| 浏览器访问宿主的插件代理入口 | 宿主登录 Cookie `session`（常见登录方式） | 宿主验证登录状态 |
| 宿主把用户请求转发给插件 `/api/v1/*` | `X-AIHub-Identity` | 插件验证当前用户身份，再检查业务权限 |
| 插件代表当前用户调用宿主标准 API | `Authorization: Bearer <委托凭证>`，另带 `X-AIHub-Plugin-ID` | 宿主验证委托身份，再检查用户权限 |
| 宿主直接调用插件 `/internal/*` | `X-AIHub-Plugin-Secret` | 插件验证服务共享密钥 |
| 插件后台读取已批准的用户目录 | `Authorization: AIHubPlugin <插件ID>:<共享密钥>` | 宿主验证插件及已批准能力，见 4.3 |

插件研发通常只需做好三件事：用户接口验证身份并检查业务权限；需要宿主数据时透传当前请求的委托凭证；内部接口验证服务共享密钥。登录 Cookie 的签发和解析由宿主完成。

### 4.1 浏览器到插件：`X-AIHub-Identity`

用户先在宿主登录。浏览器请求 `/api/plugin-bridge/{plugin_id}/api/v1/*`，宿主验证登录状态后，再把请求转发给插件。插件前端无需生成或设置 `X-AIHub-Identity`。

宿主的 `PluginIdentityAuth()` 负责鉴权并将用户 ID、会话版本等写入宿主请求 context；随后 `ProxyExtension()` 清除转发请求中的 Cookie、Authorization 和全部客户端 `X-AIHub-*` Header，重新签发 `X-AIHub-Identity` 和 `X-AIHub-Host-Authorization`。插件收不到浏览器原始登录 Cookie，也不得信任请求参数里的 `user_id` 来确定当前用户。

凭证结构为两个 base64url 无填充片段：

```text
base64url(JSON claims) + "." + base64url(HMAC-SHA256(secret, 第一片段))
```

claims 字段：`user_id`、`plugin_id`、`method`、`uri`、`request_id`、`expires_at`。宿主默认签发 30 秒有效的请求身份。

插件必须验证：

1. 共享密钥不少于 32 字符，签名使用常量时间比较。
2. `user_id > 0`，`plugin_id` 等于本插件标识。
3. `method` 与收到的 HTTP 方法一致。
4. `uri` 与插件收到的 `RequestURI` 一致，包括查询参数；它是剥离桥接前缀后的 URI。
5. 凭证未过期，且有效期不超出当前协议允许范围；organization 验证端拒绝到期时间超过当前时间 60 秒的凭证。

验证后将用户 ID 放入请求上下文，再执行插件角色及对象范围检查。参考 `plugins/organization/middleware/identity.go`；其中固定的 `organization` 必须改为新插件的标识，不能原样复制。

#### 4.1.1 验签过程与请求示例

插件使用双方事先配置的同一个插件共享密钥，重新计算签名，再检查身份声明是否对应当前请求。这一步在插件本地完成，不需要向宿主再次请求确认。可以把身份声明理解为“证明内容”，HMAC 签名理解为“用密钥制作的防伪印章”。

例如，用户张三的 ID 为 `123`，浏览器请求：

```http
GET /api/plugin-bridge/organization/api/v1/employees?department_id=10
```

这里的查询参数仅用于演示 URI 绑定验签，不表示当前员工目录接口支持按该参数过滤；实际查询行为见 4.1.3。

宿主校验张三的登录身份及插件可用状态后，将路径改写为插件实际接收的地址：

```http
GET /api/v1/employees?department_id=10
```

随后签发身份声明。以下时间戳仅为示例，真实值是签发时刻加 30 秒：

```json
{
  "user_id": 123,
  "plugin_id": "organization",
  "method": "GET",
  "uri": "/api/v1/employees?department_id=10",
  "request_id": "req-abc",
  "expires_at": 1791700030
}
```

Header 的计算过程如下；base64url 使用无填充编码，签名针对编码后的第一片段计算：

```text
A = base64url(JSON claims)
B = base64url(HMAC-SHA256(插件共享密钥, A))
X-AIHub-Identity = A + "." + B
```

Base64 编码可以被解码读取，本身不提供加密。插件按以下顺序验证：

1. 读取 `X-AIHub-Identity`，按 `.` 拆分，必须恰好有两部分；检查本地密钥长度不少于 32 字符。
2. 用本地密钥和第一片段 A 重新计算 HMAC-SHA256，解码第二片段 B，并通过 `hmac.Equal` 与计算结果作常量时间比较。
3. 签名通过后，解码 A 并解析 JSON；解析失败则拒绝请求。
4. 检查 `user_id > 0`、`plugin_id` 等于本插件 ID、`method` 等于实际 HTTP 方法、`uri` 完全等于实际 `RequestURI`（含查询参数）。
5. 检查 `expires_at` 大于当前 Unix 时间，且不超过当前时间加 60 秒。宿主默认签发 30 秒有效凭证，60 秒是当前插件验证端允许的剩余有效期上限。

| 请求变化 | 验证结果 |
|---|---|
| 将声明里的 `user_id` 从 `123` 改为管理员 ID，保留原签名 | 重新计算的签名不一致，拒绝 |
| 保留凭证，把请求查询参数改为 `department_id=20` | URI 与声明不一致，拒绝 |
| 保留凭证，把请求方法从 GET 改为 POST | 方法与声明不一致，拒绝 |
| 将其他插件的有效凭证交给 organization | 插件 ID 不一致，拒绝 |
| 凭证已过期或到期时间超出允许范围 | 时间检查失败，拒绝 |

任何一步失败，`RequireIdentity` 都会中止请求，返回 HTTP 401 和“宿主身份凭证无效或过期”。全部通过后，将声明中的用户 ID 写入请求上下文，再继续执行员工身份、模块角色和对象范围检查。

验签通过说明身份声明的签名可信，并且声明与当前方法、地址和有效期匹配；是否允许张三查看部门 10，仍由插件业务权限决定。宿主负责登录身份校验，插件不能用浏览器提供的 `user_id`、角色或部门参数替代后端授权。

#### 4.1.2 当前实现的信任边界

- 签名包含上述 claims，但不包含请求 Body 的内容或摘要，不能据此声称请求 Body 已得到完整性验证。
- 当前 `request_id` 没有一次性消费或去重检查。相同方法、URI 的凭证在有效期内重复使用，不会仅凭这段验签逻辑被拒绝；短有效期不能等同于完整的防重放机制。
- HMAC 使用共享密钥，宿主和持有该密钥的插件都具备生成身份签名的能力。因此，这套机制建立在插件受信任、共享密钥保密的前提上；签名不能区分持有同一密钥的双方。
- `X-AIHub-Identity` 与宿主回调的 `X-AIHub-Host-Authorization` 是两种不同凭证。后者由宿主独占密钥签发，插件不能使用自己的共享密钥生成宿主委托凭证。

实现依据：`common/extensions/contract.go` 的 `Sign` / `Identity`、`controller/plugin_extensions.go` 的 `ProxyExtension`、`plugins/organization/middleware/identity.go` 的 `Verify` / `RequireIdentity`；插件角色及范围检查另见插件路由与业务处理代码。

#### 4.1.3 完整示例：读取 organization 员工目录

以 `GET /api/plugin-bridge/organization/api/v1/employees` 为例：

1. **前端发请求**：插件页面使用宿主 SDK 的 API 客户端，拼接 `api_base + "/employees"`。同源登录请求由浏览器自动携带 `session` Cookie，无需插件 JS 读取或设置 Cookie。
2. **宿主验证登录**：Session 库验证 Cookie 签名并还原会话字段；`PluginIdentityAuth()` 按用户 ID 查询数据库，检查会话版本、用户状态，将当前可信身份写入 context。没有有效 Session 时，另有用户 Access Token 鉴权路径。
3. **宿主检查并转发**：`ProxyExtension()` 检查插件 SDK 版本、启用状态、授权和路径，读取注册地址，将路径改为 `/api/v1/employees`，清除原始凭证并注入两种用户凭证及 `X-AIHub-Plugin-ID: organization`。
4. **插件验证身份**：`RequireIdentity()` 验证 `X-AIHub-Identity`，把签名中的用户 ID 写入插件自己的 context。宿主 context 不会自动跨 HTTP 传递。
5. **插件检查员工身份并查询**：`RequireEmployee()` 检查该用户是否为有效插件员工；`ListEmployees()` 查询插件自己的 `org_employees` 表，并附加各员工的可查看账号、可编辑、可删除等权限标志。这条接口不要求模块管理员身份，不回调宿主 API，也不使用本次收到的委托凭证。
6. **返回前端**：插件返回 `success/message/data` JSON；宿主代理删除插件响应中的 `Set-Cookie` 和 `X-AIHub-*` Header，设置 `Cache-Control: no-store` 后转回浏览器。前端保存员工数组，再按选中部门及搜索条件筛选、排序和渲染。

注意：当前 organization 的员工目录查询不按管理范围或 `department_id` 参数过滤列表，而是返回目录及操作权限标志；页面选中 IRD 时显示的员工是前端筛选结果。新插件应自行明确目录可见范围，不能用前端筛选代替后端授权；后续写接口仍须重新检查权限。

**登录 Cookie 从哪里来、在哪里看？**

- 宿主登录成功后，将 `id`、`username`、`role`、`status`、`session_version` 写入会话，通过响应 `Set-Cookie` 保存为一个名为 `session` 的 Cookie。当前使用 Cookie Store，数据经序列化、编码和签名；仅配置认证密钥，没有配置内容加密密钥。
- 当前配置为 `Path=/`、有效期 30 天、`HttpOnly=true`、`SameSite=Strict`、`Secure=false`。`HttpOnly` 表示页面 JS 读不到它，但浏览器仍会自动发送；Cookie 未过期也不保证会话仍有效，宿主还会检查数据库中的用户状态和会话版本。
- Chrome DevTools 的 **Application → Storage → Cookies → 当前站点** 可查看 `session`。**Network → 具体请求 → Cookies / Request Headers** 可查看实际发送的 Cookie；登录响应的 **Response Headers → Set-Cookie** 可查看签发结果。若显示 provisional headers，应刷新后重新捕获请求。
- 浏览器 Network 只能看到浏览器与宿主之间的请求，看不到宿主转发给插件时注入的凭证，也看不到插件回调宿主的请求。排查时在服务端检查凭证是否存在及验证结果，不记录完整凭证。

**宿主的 `SessionSecret` 如何配置？**

`config.SessionSecret` 读取宿主配置文件中的 `session_secret`。部署时应设置为固定的随机密钥：

```yaml
session_secret: "<替换为部署时生成的固定随机密钥>"
```

- 未配置或配置为空时，宿主每次启动默认生成随机 UUID；重启后密钥变化，旧登录 Cookie 无法通过验签，用户需要重新登录。
- 配置固定值后，重启不会因密钥变化导致旧 Cookie 失效，但仍需通过有效期、用户状态和会话版本检查。修改该值也会使旧 Cookie 和旧插件委托凭证无法通过验签。
- 多实例宿主应使用相同的 `session_secret`，使不同实例能够验证同一份登录 Cookie 和插件委托凭证。
- 这是宿主自己的密钥，用于 Cookie 签名及派生 4.2 的委托凭证签名密钥；它与插件共享密钥 `host.secret` 不同，不应提供给插件或前端，也不应将真实值提交到 Git。

配置实现见 `common/config/constants.go` 的默认值和 `common/config/config.go` 的配置读取。

实现参考：`controller/user.go` 的 `setupLogin`、`main.go` 的 Session 配置、`middleware/plugin_auth.go`、`plugins/organization/web/src/api.js` 和 `plugin.jsx`、`plugins/organization/controller/service.go` 的 `ListEmployees`。

### 4.2 插件到宿主：用户委托凭证

当插件需要查询或修改宿主资源时，才使用本节凭证；纯插件数据库操作不需要回调宿主。

**这不是“个人设置 → 令牌”中的访问令牌。** 插件接入无需用户复制个人访问令牌，也不应将个人访问令牌配置为插件回调凭证。两者虽然都可以放在 `Authorization: Bearer ...` 中，但来源和验证方式不同：

| 对比项 | 个人访问令牌 | 插件用户委托凭证 |
| --- | --- | --- |
| 来源 | 用户在个人设置中获取 | 宿主代理当前用户请求时自动签发 |
| 验证方式 | 宿主按用户的 `access_token` 查询身份 | 宿主验证签名，再检查当前用户、会话版本和插件状态 |
| 插件绑定 | 不包含本协议的插件绑定声明 | 声明包含 `plugin_id`，回调时须附带匹配的 `X-AIHub-Plugin-ID` |
| 插件如何获取 | 本协议不需要使用 | 从当前入站请求的 `X-AIHub-Host-Authorization` 读取 |

生成与使用顺序：

1. 浏览器携带宿主登录 Cookie 请求插件代理入口，宿主验证当前用户身份。
2. `ProxyExtension()` 从已验证的 context 取得用户 ID、会话版本、插件 ID、客户端 IP 和 Request ID，构造 `Delegation` 声明。
3. 宿主调用 `SignDelegation(config.SessionSecret, claims)`，补充接收方 `aud=aihub-host` 和过期时间，使用派生密钥计算 HMAC-SHA256 签名，将结果注入发往插件的 `X-AIHub-Host-Authorization`。
4. 插件读取该值，作为 Bearer 凭证调用宿主标准 API；无需重新登录或向用户索要令牌。

`X-AIHub-Host-Authorization` 由宿主的 `ProxyExtension()` 在转发当前用户请求时注入，插件前端不生成、不持有该凭证。插件后端从当前入站请求读取，并在新的宿主 API 请求中设置：

```http
Authorization: Bearer <X-AIHub-Host-Authorization 的值>
X-AIHub-Plugin-ID: example
```

例如，使用 organization 的宿主客户端查询当前用户：

```go
delegation := c.GetHeader("X-AIHub-Host-Authorization")
var data map[string]any
err := s.Host.Request(
    c.Request.Context(), http.MethodGet, "/api/user/self",
    nil, delegation, &data,
)
```

其中 `Host.Request` 应在每次请求中设置 `Authorization: Bearer ` 加上 `delegation`，并设置本插件的 `X-AIHub-Plugin-ID`；参考 `plugins/organization/hostclient/client.go`。入站 Header 的值本身不带 `Bearer `。

该凭证由宿主的 `config.SessionSecret` 派生密钥签发，格式为 `aihub-delegation.<base64url声明>.<base64url签名>`；声明包含用户 ID、会话版本、插件 ID、客户端 IP、Request ID、接收方及过期时间，不包含签名密钥。默认有效 60 秒；当前仅 `agent` 的 `POST /api/v1/chat` 使用 6 分钟凭证。插件将其视为不透明字符串，不自行签发，也不用插件共享密钥替换或重新生成。

请求地址是 `host.base_url + /api/user/...` 等原生接口。不能使用 `/api/plugin-bridge/example/...` 回调宿主业务，也不能把 `X-AIHub-Identity` 当作宿主 Bearer 凭证。

宿主重新校验用户状态、会话版本、插件状态和权限。插件用户缺少宿主权限时，操作失败；不能改用管理员令牌或服务身份重试。

宿主客户端必须按请求传入委托凭证，可以复用无凭证的 HTTP transport/client，但禁止将凭证存入共享全局 Header、数据库、浏览器或日志。使用请求 context、合理超时，并避免重定向携带凭证到其他目标。

### 4.3 后台任务：受限服务身份

无用户后台任务只可使用已批准能力。当前支持 `users.directory.read`，且必须由管理员明确批准：

```http
GET /api/user/directory?after=0
Authorization: AIHubPlugin example:<secret>
```

**批准的能力保存在哪里？** 宿主将能力列表保存为插件注册信息的 `Registration.ServiceCapabilities`（JSON 字段 `service_capabilities`）。它持久化在注册文件中，不存数据库；运行时加载到宿主内存，请求鉴权时从内存读取。

```text
管理员批准能力 → 更新插件注册信息 → 写入 registry.json
宿主重启 → 从 registry.json 恢复到内存 → 按已批准能力校验后台请求
```

例如，批准用户目录读取后，注册信息中包含：

```json
"service_capabilities": ["users.directory.read"]
```

默认文件为宿主工作目录下的 `./data/extensions/registry.json`，可通过宿主配置修改：

```yaml
extensions:
  registry_path: "./data/extensions/registry.json"
```

部署时需持久化该文件所在目录，保留重启或容器重建后的插件注册信息和能力审批。插件自身声明能力不等于宿主已批准，仍以宿主保存的审批结果为准。实现参考：`common/extensions/runtime.go` 的 `Registration`、`persist` / `Restore`，`router/plugin_extensions.go` 的注册文件路径，以及 `middleware/plugin_delegation.go` 的 `PluginDirectoryAuth`。

每页最多 200 条，以返回结果最后一个 ID 继续分页，空页结束，并检查游标递增。不得访问账号写接口、额度、提醒或日志。若后台需要其他能力，应先扩展通用宿主能力模型，不能自行扩大密钥权限。

### 4.4 宿主到插件内部接口

`/internal/*` 用于宿主直接调用插件的清单、初始化、用户事件等服务接口。它使用 `X-AIHub-Plugin-Secret` 认证调用服务，不代表某位登录用户，也不经过浏览器或公开插件代理。

**双方持有同一份插件共享密钥：**宿主保存为 `Registration.Secret`；organization 插件读取 `host.secret`（也可通过 `ORGANIZATION_HOST_SECRET` 环境变量提供），启动时要求不少于 32 字符。新插件使用自己的环境变量前缀。该密钥也用于 4.1 的身份签名，与宿主独占的 `config.SessionSecret` 不同。

宿主的 `Runtime.call()` 直接设置：

```go
req.Header.Set("X-AIHub-Plugin-Secret", p.Secret)
```

例如查询用户的插件资料：

```http
POST /internal/profile
X-AIHub-Plugin-Secret: <双方约定的插件共享密钥>
Content-Type: application/json

{"user_id": 123}
```

插件必须给整个内部路由组挂认证中间件，认证通过后才执行处理函数：

```go
internal := r.Group("/internal", middleware.RequireService(secret))
internal.POST("/profile", service.InternalProfile)
```

organization 的 `RequireService` 核心判断为：

```go
if len(secret) < 32 ||
    !hmac.Equal([]byte(secret), []byte(c.GetHeader("X-AIHub-Plugin-Secret"))) {
    c.AbortWithStatusJSON(401, gin.H{
        "success": false,
        "message": "插件服务凭据无效",
    })
    return
}
c.Next()
```

这里的 `hmac.Equal` 只做常量时间比较，没有计算请求签名。Header 传递的是共享密钥本身，不带用户身份或过期时间；传输保密依赖部署网络和 HTTPS。认证通过仅说明调用方持有服务密钥，接口仍需校验 Body 和业务参数。例如 `/internal/profile` 从宿主提交的 Body 读取 `user_id`，不从浏览器参数推定当前用户。

该 Header 不能作为插件调用宿主用户业务的认证方式：它不建立宿主登录用户身份。用户业务调用使用 4.2 的委托凭证；后台目录能力使用 4.3 的专用 Authorization 格式和能力审批。

部署时不得将服务共享密钥写入插件前端源码、安装包默认配置或 Git。process 由宿主生成并注入，external 由运维安全配对。

实现参考：`common/extensions/runtime.go` 的 `Internal` / `call`、`common/extensions/deployment.go` 的 `processCommand`、`plugins/organization/main.go`、`plugins/organization/router/router.go`、`plugins/organization/middleware/identity.go` 的 `RequireService`。

## 5. 权限与数据规范

- 插件角色与宿主角色独立。导航隐藏只是交互提示，后端必须再次验证权限。
- 对每个读写接口定义角色、对象范围和数据归属；查询、导出、统计与写操作均受范围限制。
- 只具有插件权限的用户应能执行纯插件操作；不要为打开插件页面无条件要求宿主账号管理权限。
- 涉及宿主账号、额度或跨用户日志时，同时满足插件业务权限和宿主资源权限。
- 插件保存宿主用户 ID 作为引用，不复制密码或长期访问令牌，不写宿主 `users` 等表。
- 共用数据库时使用插件独立表前缀并只迁移自有表；有条件时给插件数据库账号限制表权限。
- 用户停用或删除事件只能改变插件对应的本地状态，不能因此扩大其他用户权限。
- 数据库和对象存储放在持久化位置，不放入被升级替换的程序版本目录。

## 6. 可选扩展点

| 扩展点 | 平面 | 参考要求 |
| --- | --- | --- |
| `site.navigation` | control | 前端导出 `topNavigation(profile)` 和 `Page`，在首页/控制台顶部及移动端导航注册入口 |
| `site.global.layer` | control | 前端导出 `GlobalLayer({ profile, apiBase, assetBase })`，在已登录用户页面挂载全站界面 |
| `console.navigation` | control | 前端导出 `navigation(profile)` 和 `Page`，菜单权限来自插件规则 |
| `user.profile.card` | control | 前端导出 `ProfileCard`，只展示获准的资料 |
| `user.identity.enrich` | control | 实现受保护的 `POST /internal/profile`、`POST /internal/bootstrap`；参考 organization 的请求和响应 |
| `user.events` | control | 实现受保护的 `POST /internal/user-events`，按事件 ID 幂等处理和状态更新 |
| `storage.objects` | control | 声明 `storage_directory`，通过委托身份访问宿主通用对象接口 |
| `relay.request.intercept` | data | 版本 1；鉴权后、渠道分配前处理请求 JSON，详见第 14 节 |
| `relay.response.intercept` | data | 版本 1；处理原始渠道 JSON/SSE，协议转换前执行，详见第 14 节 |

不能为了沿用 organization 模板而声明所有扩展点。不需要用户目录的插件，不申请后台目录能力。

`data.attribution`、`data.events` 已移除，清单不得声明这两个扩展点；宿主不再提供归属快照及持久化数据事件出箱链路。组织插件的调用记录页面和相关接口也已移除，部门统计使用独立的统计授权与查询链路。

宿主对 `user.identity.enrich` 插件执行相应初始化调用；新插件不得依赖宿主去调用 organization 专用的 `/internal/reconcile`。organization 的目录对账逻辑是其业务实现，不是所有插件的通用启动要求。

## 7. 宿主 REST 资源调用

| 资源能力 | 接口 |
| --- | --- |
| 当前用户 | `GET /api/user/self` |
| 账号创建、读取、删除 | `POST /api/user/`、`GET /api/user/:id`、`DELETE /api/user/:id?delete_logs=false` |
| 资料修改 | `PATCH /api/user/:id/profile` |
| 用量 | `GET /api/user/:id/usage` |
| 额度调整 | `POST /api/user/quota/:id` |
| 额度提醒 | `GET/PUT /api/user/:id/quota-alert-setting` |
| 日志和选项 | `GET /api/log/`、`GET /api/log/options` |
| 对象上传、读取 | `POST/GET /api/storage/objects` |

请求体和查询字段以宿主接口实现及测试为准。参考 `plugins/organization/hostclient/` 和 `plugins/organization/controller/accounts.go`，不要把 organization 的业务请求体直接当成宿主接口请求体。

日志 `user_ids`、`log_id` 只能缩小宿主已有授权范围。明确没有可访问用户时传递空集合语义，不能省略筛选而变成全量查询。自助日志始终仅能访问本人。

对象命名空间由宿主验证后的插件身份和清单生成，不接受客户端任意指定其他插件目录。插件上传前仍需检查自身业务权限，宿主另外检查资料写权限。

## 8. 前端接入

插件入口为 ES module `/assets/plugin.js`，通过 `window.AIHubPluginSDK` 使用宿主提供的 React、MUI、API、路由和国际化能力。

示例页面模块：

```jsx
const sdk = window.AIHubPluginSDK;
const React = sdk.React;
const { Typography } = sdk.MUI;
const pluginID = 'example';

export function navigation() {
  return [{
    id: 'tasks',
    title: '任务管理',
    url: `/panel/plugins/${pluginID}`,
    type: 'item',
    breadcrumbs: false
  }];
}

export function Page() {
  return <Typography>任务管理</Typography>;
}

export async function listTasks() {
  const bases = sdk.getPluginBases(pluginID);
  if (!bases) throw new Error('插件尚未加载');
  const response = await sdk.API.get(`${bases.apiBase}/tasks`);
  if (!response.data.success) throw new Error(response.data.message);
  return response.data.data;
}
```

`apiBase` 已包含 `/api/v1`，例如 `/api/plugin-bridge/example/api/v1`，调用时只追加 `/tasks`，不要重复追加 `/api/v1`。示例仅展示加载与请求契约，生产页面需补充权限、加载、空态、错误及国际化交互。

构建要求：

- 从 `getPluginBases(pluginID)` 取得 API 与资源地址，不硬编码 organization 或服务端口。
- 使用宿主 React/MUI，避免嵌入另一套 React 造成 hook 或上下文冲突。
- 保留 `Page`、`navigation` 等命名导出，构建入口输出固定 `assets/plugin.js`；参考 organization 的 `preserveEntrySignatures: 'strict'`。
- 资源采用能在代理前缀下加载的相对路径，避免请求宿主根目录 `/assets` 下的其他应用资源。
- 支持深色模式和宿主语言切换；关闭弹窗或通知不应导致页面重挂载、整页刷新或布局跳动。
- 保存后局部更新或重新读取相关数据；不要使用 `location.reload()` 完成普通业务操作。

### 8.1 顶部导航栏：`site.navigation`

此扩展点版本为 1，类型为 frontend。它与侧边栏 `console.navigation` 独立；仅注册顶部入口的插件无需声明侧边栏扩展点。已登录用户加载活动插件后，宿主同时在首页布局、控制台布局和移动端菜单渲染入口；游客不加载插件。

```jsx
export function topNavigation(profile) {
  if (!profile?.active) return [];
  return [{
    id: 'tasks',
    title: '任务管理',
    url: '/plugins/example',
    icon: 'tabler:list-check',
    before: 'about'
  }];
}

export function Page({ profile, path = '' }) {
  return <Typography>{path || '任务管理'}</Typography>;
}
```

- `topNavigation(profile)` 同步返回数组。`id` 为插件内唯一的字母、数字、下划线或连字符标识；`title` 为当前宿主语言的非空文本；`icon` 为 Iconify 名称，省略时使用通用插件图标。
- `url` 只能为本插件的 `/plugins/{id}`、`/plugins/{id}/...` 或 `/panel/plugins/{id}`、`/panel/plugins/{id}/...`，禁止外部 URL、查询/片段、编码路径、反斜线和 `.`/`..` 路径段。
- 宿主稳定导航 ID：`home`、`console`、`experience`、`models`、`plugin-marketplace`、`docs`、`about`。`before` 指定其中一项；省略或目标当前不可见时放在“关于”之前。
- 多插件按插件 ID、项目 ID 稳定排序。无效项目、重复 ID、非数组返回或抛出异常只撤回对应插件贡献。
- `/plugins/:pluginID/*` 使用独立页面布局，登录保护不要求控制台菜单权限；`Page` 收到 `profile` 和不带前导 `/` 的子路径。插件后端必须再次验证业务权限。
- 页面导出和导航声明不改变代理规则。SDK v2 的 `getPluginBases(id).apiBase` **已经包含 `/api/v1`**，请求应拼接 `/tasks` 等业务路径；`assetBase` 已包含 `/assets`。
- 插件停用、过期或加载失败后撤回导航；页面显示不可用。导航标签需跟随宿主语言切换，桌面和移动端使用同一贡献集合。

反馈插件参考 `plugins/feedback/`：声明 `site.navigation`、`user.identity.enrich`、`storage.objects`；用户目录读取属于管理员显式批准的 `service_capabilities`，不是清单扩展点。其图片上传/读取仍受宿主个人资料权限约束，插件管理员身份不绕过宿主权限。

### 8.2 全站界面：`site.global.layer`

此扩展点版本为 1，类型为 frontend，平面为 control。活动插件声明该扩展点并导出 React 组件 `GlobalLayer` 后，宿主在插件运行时容器中挂载它；无需用户先进入插件页面。组件收到本插件的 `profile`、`apiBase`、`assetBase`，适合帮助面板、助手入口等跨页面交互。

组件自行检查插件资料与业务权限，避免遮挡宿主导航；卸载时清理事件监听、定时器和未完成请求。宿主停用插件、用户退出或版本变化时会卸载对应界面。Vue 和 HTML 实现也必须通过 React 适配组件导出，不能直接导出 Vue 组件对象或 HTML 字符串。三种完整写法见 [前端样例](sdk-v2-examples/frontend/README.md)。

## 9. 配置、工程结构与打包

建议的 Go 插件结构：

```text
plugins/example/
  go.mod
  main.go
  plugin.json
  config.yaml
  router/
  middleware/
  controller/
  model/
  hostclient/
  web/
  scripts/
  Makefile
  README.md
```

目录位置不是接入限制；插件应使用独立 Go 模块，保持构建独立。

process 配置必须读取宿主提供的 `plugin.id`、`server.address`、`host.base_url`、`host.secret` 及数据库、存储配置。启动时确认 `plugin.id` 与嵌入清单一致。环境变量前缀与注册目录的 `env_prefix` 一致；不能沿用 `ORGANIZATION_` 作为新插件前缀。

process 配置生成和环境覆盖具体字段参考 `common/extensions/package.go`、`common/extensions/deployment.go`、`plugins/organization/main.go`。宿主会过滤对应前缀的旧配置环境变量，并注入本次注册身份，插件不得另用固定配置覆盖这些值。

ZIP 根目录只允许：

```text
example           # 或清单 backend 指定的文件名
plugin.json
config.yaml       # 可选，不能含真实生产密钥
```

不允许外层目录、符号链接、重复条目或其他文件；当前解压总大小上限为 150 MiB。前端资源应嵌入可执行文件等包内受支持的方式，不能在 ZIP 中额外放 `web/` 目录。

建议产物命名 `example-1.0.0-<GOOS>-<GOARCH>.zip`。使用 CGO/SQLite 时在目标原生环境构建；Linux process 包不能使用 macOS 二进制。构建和包内清单必须使用同一版本。

## 10. 注册、部署与升级

管理员在插件目录登记完整清单、支持模式、平台安装包、环境变量前缀和必要授权。例如平台包配置：

```json
{
  "packages": {
    "darwin-arm64": "/absolute/path/example-1.0.0-darwin-arm64.zip",
    "linux-amd64": "/absolute/path/example-1.0.0-linux-amd64.zip"
  },
  "modes": ["process", "external"],
  "env_prefix": "EXAMPLE_"
}
```

以上是注册目录字段片段，不是 `plugin.json` 字段。当前市场 process 包按宿主本地文件路径读取，不能直接填写一个 HTTP 下载地址。已有目录记录需显式更新，不能依赖默认目录覆盖。

process：宿主安装版本目录、分配本机端口、生成配置、启动子进程、检查内部清单，再登记活动目标。external：运维先部署服务，确认 HTTP/HTTPS origin 地址和共享密钥，宿主完成验证与登记。

external 安装表单可填写“通信密钥 Secret”。市场 `install`、`trial`、`purchase` 安装请求接受可选字符串字段 `secret`：非空输入值优先；留空或不提交时沿用目录现有凭据解析规则，即配置了 `secret_env` 时读取宿主环境变量，否则使用目录 `secret`。密钥按原值使用，不自动裁剪；选定值必须满足至少 32 字符及插件鉴权校验，输入值无效时不回退到目录凭据。

插件目录还支持可选的回调地址默认值（不属于 `manifest`）：

```json
{
  "host_url": "https://hub.example.com",
  "data_host_url": "https://data.example.com"
}
```

`host_url` 用于插件 → 主程序控制面；插件声明了数据面扩展点时，`data_host_url` 用于插件 → 主程序数据面。安装弹窗自动填入目录默认值，数据面字段仅在有数据面扩展点时显示。`install`、`trial`、`purchase` 的非空输入值优先，留空或不提交时沿用目录默认值；无数据面扩展点时不继承目录的 `data_host_url`。地址必须为 HTTP/HTTPS origin，不能含业务路径、查询、片段或用户名密码。安装覆盖值只保存到安装记录，不回写目录；目录编辑不会更改已安装插件的运行地址，续授权和升级继续沿用安装记录。旧目录不配置这两个字段时保持原有行为；数据面地址均未配置时沿用控制面地址。

安装覆盖值只持久化到该插件的 `Registration.Secret`，不回写目录。卸载后重装重新应用上述规则；已安装插件续授权、升级及宿主重启沿用已保存值。process 模式继续由宿主生成密钥，安装表单不提交 external 密钥。安装结果及市场列表不返回密钥，HTTP 审计中的 `secret` 字段按现有敏感字段规则脱敏。

两种方式浏览器都只访问固定插件前缀；重启或端口变化不能要求用户修改访问地址。

发布新版本必须同时更新程序、清单、前端入口和目录版本；保证旧数据库兼容或给出迁移及回滚限制。备份注册表、持久化数据和旧包，失败时按兼容关系回滚。不能在升级时删除持久化目录或自动提升宿主用户权限。

### 10.1 节点与部署模式

| 模式 | 节点限制 | 实例与地址管理 |
| --- | --- | --- |
| `process` | 仅 master 主进程托管；插件须适用于当前节点 | 同一宿主仅登记一个同 ID 插件并托管一个子进程，重复安装被拒绝 |
| `external` | master/slave 均可使用，前提是插件有匹配当前节点的扩展点 | 插件侧自行部署、扩缩容和负载均衡，宿主登记一个服务或负载均衡 Base URL |

slave 不提供 process 安装选项；手动安装、市场安装和升级也拒绝该模式。恢复注册文件时，不适用于当前节点的注册记录及启用偏好保留，但不启动、不探测该插件，不将其作为当前节点的活动插件。

宿主以本地注册文件保存安装状态与配置，路径来自 `extensions.registry_path`，默认 `./data/extensions/registry.json`。启动恢复后，适用且已启用、授权有效的 process 插件由宿主重新启动，external 插件由宿主验证连接。市场运行状态来自宿主 Runtime 的 `enabled`、`status`、`error` 等字段；登记或拥有授权不等于服务正在运行，检查失败会体现为失败状态。此机制不提供多个宿主节点间的注册配置同步。

external 多实例不在宿主登记实例列表。运维为插件配置统一的负载均衡入口与共享通信密钥；插件 → 宿主的回调地址必须从插件实例所在网络可达，不应使用只能从宿主自身访问的 loopback 地址。

### 10.2 运行信息与双向 Base URL 配置

点击市场中已安装插件的卡片，打开运行信息弹窗。弹窗展示模式、版本、当前节点平面、状态、错误、托管 PID/端口和扩展点平面，并提供两个地址：

| 注册字段 | 调用方向 | external 示例 |
| --- | --- | --- |
| `url` | 宿主 → 插件 | `https://plugins.example.com`，可为插件侧负载均衡入口 |
| `host_url` | 插件 → 宿主 | `https://hub.example.com`，供插件回调宿主 REST API |

两个字段属于注册配置，不属于 `manifest`。`host_url` 优先使用注册顶层值，历史记录可回退到 `deployment.host_url`。安装 external 插件时可配置回调地址；已有插件通过运行信息弹窗修改。修改访问地址不改变 process 插件监听端口。

宿主接口使用现有管理端 `success/message/data` 响应格式：

| 宿主接口 | 权限与用途 |
| --- | --- |
| `GET /api/plugin-marketplace/:id/runtime` | 插件市场启用时，管理员读取；返回宿主已知信息，并查询插件实际回调地址 |
| `PUT /api/plugin-marketplace/:id/runtime` | 插件市场启用时，同时要求 root 与扩展管理权限；修改两个地址，记录 `runtime.configure` 审计 |

PUT 请求示例：

```json
{
  "url": "https://plugins.example.com",
  "host_url": "https://hub.example.com"
}
```

两个地址必须为 HTTP/HTTPS origin，可包含端口，不能包含业务路径、查询、片段或用户名密码。保存流程如下：

1. 校验地址；使用现有共享密钥访问新插件入口的 `/internal/manifest`，验证完整清单一致，并读取其实际回调地址。
2. 暂停接纳该插件的新业务请求，等待已接纳的请求结束，避免旧请求把回调地址改回旧值。
3. 调用插件 `PUT /internal/runtime` 更新实际回调，然后切换宿主注册地址并持久化注册文件。
4. 更新失败时尝试恢复插件旧回调；注册文件保存失败时恢复宿主旧配置并尝试恢复插件旧回调。回滚失败会报告错误，不能视为跨服务原子事务。

插件内部运行配置契约为：

| 插件接口 | 请求/响应 |
| --- | --- |
| `GET /internal/runtime` | 直接返回 `{ "host_url": "https://hub.example.com" }` |
| `PUT /internal/runtime` | 接受相同结构的 JSON，成功时返回 HTTP 200 |

以上接口必须验证 `X-AIHub-Plugin-Secret`，不能经公开插件代理暴露。组织架构、问题反馈会校验新地址，将 `host.base_url` 写回本实例配置文件后更新内存客户端；配置文件不可写时修改失败，原地址保留。环境变量仍具有启动配置优先级。

宿主设置回调地址后，在认证的内部请求中附带 `X-AIHub-Host-Base-URL`；插件验证共享密钥后同步此值。负载均衡下，一次 PUT 只到达一个实例，其余实例在收到带该 Header 的宿主内部请求后逐步同步，不保证保存时所有实例同时更新。宿主不枚举副本，也不提供全副本即时回滚；各实例配置文件均须可写，回滚及重启后仍以宿主保存的回调配置逐步收敛。

GET 运行信息仅查询插件实际回调，不附带覆盖回调的 Header。旧插件不支持运行配置接口、服务不可达或回调地址无效时，弹窗仍展示宿主已知信息及错误，但禁用地址编辑；须更新插件或恢复服务后再修改。

## 11. 部分失败、取消与重试

- 明确每一步的副作用及完成标记；已有已知账号或对象 ID 时，继续未完成步骤，不重新创建。
- 写请求响应丢失不等于请求未执行。无幂等保障的创建、删除或额度调整不得盲目自动重试。
- 金额用精确十进制或定点数处理，先验证格式和范围，避免浮点差额或并发覆盖。
- 将浏览器取消传递到宿主 HTTP 调用；事务只覆盖插件本地数据库，不宣称跨服务原子提交。
- 后台任务不得保存短期用户凭证延迟执行；只执行服务身份获准的能力。
- 同步和事件要具备幂等、游标或去重机制；具体持久化策略按插件业务需要实现。

organization 的创建失败步骤、删除 `HostDeleted` 标记和精确额度差额可作为参考，不能直接照搬为所有业务的通用事务方案。

## 12. 验收与交付清单

发布前必须提供以下证据：

- 清单合法，重复标识和服务清单不一致被拒绝，修改显示名称不改变访问地址。
- 与另一个插件使用相同内部路径时分别到达正确服务，不串路由。
- 身份伪造、过期、错误插件 ID、方法或 URI 不匹配均被拒绝；内部接口不能通过公开代理访问。
- 插件角色、对象范围和宿主资源权限均经过成功与失败场景验证；服务身份不能绕过用户权限。
- 方法、查询、JSON、上传、下载和取消正确处理；上游不可达或停用有明确错误状态。
- 无权限用户、空数据、部分失败和重复操作有稳定行为；前端支持深色模式及国际化。
- 顶部导航在两种布局、桌面/移动端、语言切换和退出登录时正确更新；旧链接重定向保留查询，错误导航贡献不影响其他插件。
- 真实 process 安装/重启通过；声明支持 external 时也要验证真实外部服务链路。
- 平面由宿主扩展点定义；混合插件仅执行本节点扩展点，slave 不启动 process，历史 `manifest.plane` 不影响生效规则。
- 运行信息读写权限正确，清单不匹配、非法 Base URL、配置写入失败均不发布新配置；并发修改等待已有请求结束，失败回滚有明确结果。
- external 使用统一负载均衡入口验证至少两个实例的回调逐步同步、配置持久化和重启恢复；运行信息弹窗在浅色/深色主题下可查看和保存。
- 插件测试、相关宿主回归测试和前端生产构建通过；依赖外部环境而跳过的测试明确列出。
- 涉及宿主代码时按仓库要求执行 GitNexus impact 与变更分析，不能以静态分析代替权限测试。

交付物：源代码、版本化清单、目标平台包或镜像、注册目录配置、配置说明、数据库迁移说明、部署升级与回滚步骤、测试结果，以及明确的宿主最低兼容版本。

## 13. organization 参考文件与复用边界

| 参考位置 | 可参考内容 | 新插件需要调整 |
| --- | --- | --- |
| `plugins/organization/plugin.json` | 清单与扩展点声明 | 标识、版本、扩展点和存储目录 |
| `plugins/organization/main.go` | 配置、资源嵌入、启动初始化 | 模块名称、环境前缀和业务迁移 |
| `plugins/organization/middleware/identity.go` | 签名、方法、URI 和过期校验 | 固定 plugin ID |
| `plugins/organization/router/router.go` | 公开 API 与内部接口分组 | 业务路由及业务权限 |
| `plugins/organization/hostclient/` | 请求级宿主调用、响应失败处理 | 客户端 plugin ID 和实际资源需求 |
| `plugins/organization/controller/accounts.go` | 跨资源步骤及部分失败处理 | 业务副作用、状态与重试条件 |
| `plugins/organization/web/vite.config.js` | 固定入口和保留导出 | 项目路径及构建配置 |
| `plugins/organization/web/src/api.js` | SDK 地址及统一 API 适配 | 本插件标识 |
| `plugins/organization/scripts/package.py` | 原生包与清单打包 | 可执行文件名和产物名 |

组织、员工、部门角色、目录同步和首位组织管理员初始化均是 organization 业务，不是新插件必需功能。复制参考代码前逐项核对固定字符串、模型和授权判断。

相关实现记录：[SDK v2 实现与部署方案](plugin-sdk-v2-implementation-and-deployment.md)。

## 14. 数据面拦截与 example 参考项目

`plugins/example` 是独立 Go 模块，复用宿主 React/MUI 和 SDK；包含演示配置、记录 API、原生打包脚本、目录和注册配置。不得导入宿主业务模型；独立通信类型位于 `common/pluginapi/relay`（导入路径 `ai-hub-plugin-api/relay`）。

### 14.1 入口、顺序与租约

`relay.request.intercept` 在 API Key 完整鉴权之后、渠道分配／计费之前执行，一次用户请求仅执行一次。仅覆盖 Chat/Completions、Responses、Claude Messages、Gemini 文本生成 JSON/SSE 的 POST 路由；鉴权失败、模型列表、通知、健康检查、音视频、异步任务和实时调用不执行。插件返回的 JSON 恢复到 Body、ContentLength 和请求体缓存，后续模型权限、格式校验、路由和计费必须使用此版本。

`relay.response.intercept` 在模型渠道 HTTP 响应到达后、供应商错误解析／协议转换之前执行。仅在该模型请求 context 显式绑定响应处理器；公共 HTTP 请求器默认不执行钩子，通知等调用不受影响。响应包括非成功 HTTP 响应。通用请求器属于 CRITICAL 影响范围，必须执行协议与权限回归。

两处扩展点都按插件 ID 升序串行处理，前一个输出作为后一个输入。请求开始时按活动状态、授权、平面和运行配置原子获取插件快照并增加执行租约；整个渠道重试和响应处理共享此快照，结束或取消时释放。已接纳后不可达、超时、panic、非法输出和协议错误必须终止，不静默跳过。无匹配插件保持原链路。

### 14.2 请求 JSON 契约

服务提供受共享密钥保护的 `POST /internal/relay/request`。验证 `X-AIHub-Plugin-Secret`，内部地址不得通过公开插件代理访问。

```json
{
  "metadata": {
    "request_id": "req-example", "user_id": 7, "token_id": 9,
    "protocol": "openai", "model": "model-name", "stream": true,
    "debug": false, "attempt": 1
  },
  "body": {"model":"model-name","stream":true,"messages":[{"role":"user","content":"hello"}]}
}
```

`protocol` 为客户端协议，Responses 的请求兼容 OpenAI 鉴权；响应阶段单独标记渠道协议 `responses`。元信息由宿主签发，不传 API Key、Cookie、Authorization 或渠道密钥。

成功返回 HTTP 200：`{ "body": <处理后的 JSON 对象>, "summary": { "action": "pass|replace", "hits": 0 } }`。拒绝返回 HTTP 200 且包含 `error: { "code": "request_rejected" }`、摘要 `action: "reject"`；宿主映射为客户端 403。其他服务异常／非法 JSON／超限／协议错误转为安全的本地错误。拒绝后不请求渠道、不预留额度。

### 14.3 单次双向响应会话

服务提供受相同共享密钥保护的 `POST /internal/relay/response`，请求与响应均为 NDJSON（`application/x-ndjson`）。这是内部通信格式；渠道 NDJSON 不在支持范围。每个响应、每个插件仅建立一次 HTTP 会话，不为每个 token 创建请求。HTTP/1.1 服务须在原始 writer 调用 `http.NewResponseController(w).EnableFullDuplex()`，并立即 Flush；Gin writer 包装不能直接启用。HTTP 客户端独立于控制面的两秒总超时客户端。

| 方向／帧 | 内容与语义 |
| --- | --- |
| 宿主 `begin` | `metadata`：可信请求信息＋渠道 ID/type、渠道协议、HTTP 状态、Content-Type、尝试次数 |
| 插件 `ready` | 确认开始；未确认不能提交数据 |
| 宿主 `data` | `unit: {sequence: 1, data: "<base64 原始字节>"}`；JSON 为一个完整对象，SSE 为一个完整事件 |
| 插件 `ack` | 每个 data 必须一个 ack；`outputs: [{sequence, data}]`，可暂缓输出；`summary` 为累积处理动作和命中数 |
| 宿主 `end` | 渠道输入结束；插件须刷新尾部缓冲 |
| 插件 `end` | 最后 outputs＋summary；必须输出全部待处理单元，并成功确认收尾 |
| 插件 `error` | `error: {code: "<安全机器码>"}`；立即停止，不将异常文本或堆栈返回宿主／浏览器 |

sequence 从 1 连续递增。每个输入必须恰好产生一个同 sequence 输出且顺序不变，不能丢弃、重复、伪造、合并或重新排列事件；文本可变，其他 JSON 字段必须保持深度相等。单元上限 8 MiB，待处理上限 256 单元／16 MiB；NDJSON 帧上限 24 MiB。ack 可释放此前多个单元，实现跨事件文字匹配；不得整段缓存生成。

连接和 TLS 握手默认两秒；开始确认及已提交处理单元的响应等待默认五秒。等待下一份渠道数据沿用上游超时，不被五秒插件处理超时误杀；下游写出有背压，不将慢消费者计为插件响应超时。客户端取消关闭渠道、插件会话与管道，并等待工作 goroutine 结束后释放租约。

SSE 按完整事件读取，支持分包、UTF-8、多行 data、注释心跳、结束事件、`[DONE]`。JSON/SSE 之外的渠道 Content-Type 在启用响应钩子时明确报错。usage、模型、工具调用结构及终止语义受宿主校验，示例只替换已识别文本字段，不修改工具参数或非文本内容。普通 JSON 与终止 SSE 事件等待 end 确认再交给原解析器，防止输出后发生的插件异常被当成成功。无终止语义的意外 EOF 必须失败。Gemini 在所有已出现的候选带 finishReason 后正常 EOF 收尾，继续保留末尾 usage；其他协议依赖明确终止事件。有效多行 JSON data 在校验后折叠为单行，供宿主现有逐行协议解码器读取。

示例按 choice／内容块维护独立的有限尾部窗口；安全文本前缀可以及时返回，可能参与匹配的尾部等待下一事件，Responses done／completed 快照使用相同替换规则。边界和缓冲上限超出即失败。已经发出的正文无法撤回。

### 14.4 错误、计费与审计

插件失败包装为本地终止错误，不触发换渠道重试、渠道熔断或自动禁用。尚未写响应时返回客户端协议的 JSON 错误；流式已开始时不能改 HTTP 状态，发送 OpenAI／Claude／Gemini 支持的错误事件后关闭。计费收尾仍由原流程执行，插件审计不产生消费，也不重复释放／扣款。

每个实际执行插件的请求结束时写一条宿主 `logs.type=6` 审计，复用 `metadata.plugin_steps`，包含插件顺序、版本、尝试、渠道、动作、耗时、错误代码、事件数／字节数和终止状态。所有日志级别保存摘要，不受 `LogConsumeEnabled` 影响。仅 debug 保存正文：每份 64 KiB，单请求总共 512 KiB，UTF-8 安全截断并标记。流式保存最后有效内容，终止标记另记，避免 `[DONE]` 覆盖正文。panic 堆栈只记录服务端，数据库记录安全摘要和 request ID；通过原错误去重标记避免重复异常日志。数据库失败输出带 request ID 的服务端错误，不能宣称已落库。

example 在自己的表中每个“请求＋扩展点＋渠道尝试”保存汇总记录，开始创建、结束更新，中途最多每秒更新一次。`GET /api/v1/records`／`:id` 验证宿主身份签名，再以当前用户委托凭证调用宿主 `/api/user/self` 查询当前权限；普通用户只能本人，管理员可查看全部，不能信任浏览器角色或用户过滤。页面支持深色模式、移动端与宿主语言；执行中每两秒刷新，隐藏或完成后停止；不保存完整流回放。

### 14.5 部署与验证

master/control 与 slave/data 隔离不变。process 只允许 master 托管，example 的 process 包用于控制面安装／重启验证；完整示例让两端连接同一 external 服务。两端 registration 均填写相同 master `host_url`，防止运行配置来回覆盖。external 多实例必须共用密钥、master 回调和 MySQL/PostgreSQL 数据库；SQLite 只用于单实例演示。

流式代理须关闭请求／响应缓冲，使用 HTTP/1.1。example 附 Nginx 模板，实际部署需验证 ready 和首个 ack 在请求体结束前到达、首包不等待整段回复、取消能传播。真实 HTTP/1.1 会话由测试验证；模板不能替代实际代理环境验证。

运行 `plugins/example/README.md` 中的测试和 native package 环境变量命令，覆盖鉴权与当前权限、双向会话、跨块脱敏、usage／工具保护、EOF／超时／取消、摘要与 debug 截断、实际 process 安装／重启，以及 master＋slave＋同服务 external 链路。MySQL/PostgreSQL 实际服务连接和代理部署按目标环境补充验收。

## 15. 全部扩展点实现样例

样例与本文同目录维护，入口为 [sdk-v2-examples/README.md](sdk-v2-examples/README.md)。代码可直接阅读、构建和运行；每种语言都有完整文件，不以伪代码代替接口实现。

| 扩展点 | 实现内容 | 样例入口 |
| --- | --- | --- |
| `site.navigation` | `topNavigation(profile)` 注册顶部入口，`Page` 展示页面 | [React / Vue / HTML](sdk-v2-examples/frontend/README.md) |
| `console.navigation` | `navigation(profile)` 注册侧边栏入口，复用 `Page` | [React / Vue / HTML](sdk-v2-examples/frontend/README.md) |
| `user.profile.card` | `ProfileCard` 展示已授权的插件用户资料 | [React / Vue / HTML](sdk-v2-examples/frontend/README.md) |
| `site.global.layer` | `GlobalLayer` 跨页面帮助入口与生命周期清理 | [React / Vue / HTML](sdk-v2-examples/frontend/README.md) |
| `user.identity.enrich` | 内部用户资料、幂等初始化、公开接口身份验证 | [Go](sdk-v2-examples/go/README.md) / [Java](sdk-v2-examples/java/README.md) |
| `user.events` | 校验事件、去重、更新插件用户状态 | [Go](sdk-v2-examples/go/README.md) / [Java](sdk-v2-examples/java/README.md) |
| `storage.objects` | 委托身份上传/读取对象，插件内对象归属检查 | [Go](sdk-v2-examples/go/README.md) / [Java](sdk-v2-examples/java/README.md) |
| `relay.request.intercept` | 请求 JSON 的放行、替换和拒绝 | [Go](sdk-v2-examples/go/README.md) / [Java](sdk-v2-examples/java/README.md) |
| `relay.response.intercept` | 单会话 NDJSON 双向流，按序逐单元原样传递 | [Go](sdk-v2-examples/go/README.md) / [Java](sdk-v2-examples/java/README.md) |

任选一种前端与一种后端即可组合运行；三种前端共享宿主 SDK，两种后端读取同一份 `plugin.json`。示例统一使用 `example`，不能与现有同 ID 插件同时注册。它们按 external 模式运行；完整 control/data 演示须按第 10.1 节在相应宿主节点注册。

样例采用单进程内存业务状态，便于展示协议。生产接入须将用户状态、事件去重记录和对象归属持久化，并设计目录对账；不能把演示状态当成持久化权限系统。响应拦截采用合法的 `pass` 实现；跨 SSE 事件修改文本的完整实现另见第 14 节的 `plugins/example`。

## 共用图片选择器（宿主可选能力）

宿主可通过 `window.AIHubPluginSDK.components.ImagePickerDialog` 提供共用图片选择器。插件必须先检测该组件，旧宿主或独立运行入口缺少它时回退为手动上传。

组件参数：`open`、`value`（当前图片地址）、`purpose`（`avatar` 或 `organization-logo`）、`name`（可选组织名称）、`onClose`、`onConfirm`。`onConfirm(file, selection)` 可返回 Promise；图片确认返回校验后的 `File`，移除返回 `null`，未修改时 `selection.unchanged` 为 `true`。图片附带来源元数据 `selection.taskId`（生成任务）或 `selection.url`（素材地址），头像适配器沿用任务转存或素材地址保存。个人头像模式兼容原有 URL 输入，通过 `selection.url` 返回；组织 Logo 不接受任意远端 URL。

选择器共用 AI 生成、素材库和手动上传，不保存个人资料或插件业务记录。插件应保留图片草稿，提交业务表单时调用自己的上传 API。组织 Logo 支持 JPEG/PNG/WebP、最大 5 MB，过大的生成结果压缩后再返回。

宿主接口：

- `GET /api/user/images/library?purpose=organization-logo&scope=organization|all&cursor=...`：沿用原头像素材库的登录用户共享图片可见范围，Logo 分类默认读取 `plugins/organization/logos/`，保留存储分页游标。
- `GET /api/user/images/content?key=...` 或 `?task_id=...&index=...`：读取共享图片对象或当前用户成功图像任务中的图片，返回图片字节；不接受客户端提供的下载 URL。
- `POST /api/user/images/generate`：`purpose`、`name`、`style`、`prompt`、可选 `image`；头像模式兼容 `subject`、`hair`、`background`。沿用个人设置的模型选择、生成授权、计费、API Key 与用户限额，响应保留图像列表及任务 ID 头。

原头像接口继续兼容。主程序更新后再安装组织插件 1.3.2；已有插件目录需手动同步版本和安装包路径。
