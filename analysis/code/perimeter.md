# PERIMETER: secrets, connections, vendor server, providers, third-party additions (TAO·CODER 3.1.2)

`ext@N`/`wv@N` = byte offset in `dist/extension.js` / webview `index.js`; `NN_x.js @N` = chunk unit; upstream = `code/upstream/u*`. **[inf]** = inference.

## 1. Secrets

### 1.1 Storage backend (mostly inherited from Cline)
- **File store.** `VJc()` builds `clineDir || $CLINE_DIR || ~/.cline` + `/data`, then `secrets: new xJe(join(r,"secrets.json"),"Secrets",{fileMode:384})` (0600). Next to it sit `globalState.json` and `workspaces/<hash>/workspaceState.json` (ext@22593707). Writes are atomic (`wx` temp file, then `renameSync`, ext@~22592950).
- **This is upstream Cline code**: same strings in u3.78.0@20918594, u3.84.0@20944794, u4.0.12@21011173. Settings live in `~/.cline/data/settings/` (ext@~8846600). [inf] A real Cline install on the same machine shares these files.

### 1.2 SecretStorage → file migration
`AYc(t,e)` is invoked on every activation, before the controller is created (`n=VJc({workspacePath:r}); await AYc(t,n)`, ext@~22640500), but does nothing once the marker is ≥1. The first time:
```
for key in PREDEFINED_SECRET_KEYS (wy):          # ext@~7708900
    v = await vscode.secrets.get(key)
    if v and not fileStore.secrets[key]: batch[key] = v   # existing file values win
fileStore.secrets.setBatch(batch); globalState[__vscodeMigrationVersion] = 1
```
Nothing is deleted. Afterwards VS Code SecretStorage is touched only by two old upstream migrations (ext@22599791, ext@22602269); `n.secrets.onDidChange` (ext@22650780) is the **file** store. The log line "Access token retrieved from SecretStorage" (ext@~22630700) is misleading.

### 1.3 What TAO added to the store
- **Nine new predefined keys** (diffed against u4.0.12): `siliconFlowApiKey`, `neuralDeepApiKey`, `taoCoderWebSearch{Tavily,Serper,Brave,Custom}ApiKey`, `taocoderAccessToken`, `taocoderRefreshToken`, `taoCoderJevApiKey`.
- **Custom keys.** Any `[A-Za-z0-9_-]+` key except `__proto__`/`constructor`/`prototype` is allowed (`m_`, ext@~7709300). Custom keys are indexed in `globalState.customSecretKeys`. At startup, keys found in the file but missing from the index are added back to it (`16_secrets.js @10536312`).
- **Cross-window sync.** chokidar **polls `secrets.json` every 100 ms** and reloads on hash change (`16_secrets.js @10544498`).

### 1.4 Placeholder extraction ("scrubbing")
`t2e.processConfigSecrets(name, cfg)` for MCP (`16_secrets.js @16030323`) and `bIr` for REST (ext@~16073500) do the same thing:
```
for (loc, val) in cfg.env (MCP only) + cfg.headers:
    skip if val already contains {{SECRET:…}}   (REST also skips content-type, accept, user-agent, …)
    if keyName ~ /authorization|x-api-key|token|secret|password|api_key|…/
       or val ~ /^(Bearer|Basic|Token|Api-Key) …/
       or (len(val) >= 16 and has letters+digits and >80% [A-Za-z0-9._-]):
        k = existing custom key with identical value  or  new key
            (MCP "<server>_env_<n>" / "<server>_headers_<n>"; REST "<server>_{auth|api|token|key}_key")
        store[k] = val; cfg[loc] = "{{SECRET:k}}"
```
Where the scrubbed copy goes:
- **Written back to disk** only when MCP JSON is saved from the UI (`BFc`/saveMcpSettingsJson, ext@21190776: `let s = i ? JSON.stringify(o) : e.jsonContent; await B0(n, s)`).
- **In memory only** on MCP file load/change (ext@16047499) and REST load (ext@16091246). [inf] The plaintext stays in the file and is also copied into `secrets.json`.
- **Not scrubbed:** REST `oauth.clientSecret` (schema ext@16064322; extraction looks only at `headers`).
- [inf] The heuristic over-matches (e.g. `MAX_TOKENS`, 16+ char model ids or paths).

### 1.5 Resolution at execution time
The regex is `cIr=/\{\{SECRET:([A-Za-z0-9_-]+)\}\}/` (`16_secrets.js @16020488`). `lIr` handles strings and `t0e` walks objects (depth ≤10) (`@16018988`, `@16019289`).

| Sink | Where | Behaviour when a key is missing |
|---|---|---|
| `execute_command` | ext@20565755: `let O=lIr(B)` **after** classification, approval and hooks; second guard ext@20922855 | tool error listing available key names (`dIr`, @16020045) |
| MCP connect (env, headers, args, url) | ext@16037716 `s=t0e(o).resolvedObject` | silent: the literal placeholder is left in place |
| MCP tool arguments | ext@20754168 | tool error |
| REST headers | `executeEndpoint`, ext@~16088450 | **warning only**; the request goes out with the literal `{{SECRET:…}}` |
| `use_rest_api` arguments | ext@20758852 | tool error |

The approval UI and chat history keep the placeholder form (`say("command", f)` with the unresolved `f`).

### 1.6 Masking
- **Settings UI:** the `getSecrets` RPC returns `first4 + "*"… + last4`, or `****` for values of 8 characters or fewer (`B7g`, ext@~21181300). [inf] For 9–16 character secrets this shows most of the value.
- **Agent-requested secrets** (`manage_connections set_secret`, ask `secret_input`): the value travels over a separate `taocoder_secret_submit` message (wv@3403609 → ext@~22636400); the ask text is blanked (`currentAskType==="secret_input"?"":e.text`, ext@21461755), so it never reaches chat or the LLM.
  - [inf] Bug: `handleSetSecret` (ext@20778079) and `collectMissingSecrets` (ext@~20771200) expect `messageResponse` with text, so they report failure although the secret was saved.
- **Logs and exports:** the REST debug log masks fields by key name (`x70` → `"[REDACTED]"`, ext@16076232). Handoff export masks by regex: PEM keys, `sk-`, `AIza`, `AKIA`, `xox*`, `ghp_` → `[REDACTED_SECRET]` (ext@~20707200).
- **Command output is not masked** (returned unchanged). [inf] The resolved command also reaches the terminal and shell history.

### 1.7 OAuth
- **MCP OAuth is upstream** (`mcpOAuthSecrets` and `getOrCreateProvider` counts match u3.84.0). TAO only added the `${env:}` and `{{SECRET}}` resolution described above.
- **REST OAuth is TAO's own** (`vIr`, ext@~16065200): PKCE S256, `state` valid 10 min, redirect via URI handler `/rest-api-auth/callback/<name>` (`16_secrets.js @13494623`).
  - **Storage:** one JSON blob in secret `restApiOAuthSecrets`, keyed by `sha256("name:baseUrl")[:16]`.
  - **Refresh:** only when `expires_in` is known and has passed; the old `refresh_token` is kept if none is returned.

## 2. Vendor server `api.taocoder.thinkingos.tech`

Base URL `W70`, can be overridden with `TAOCODER_API_URL` (ext@16102103). Every authenticated call sends:
- `Authorization: Bearer <access token>`;
- `$k()` headers (ext@8483638): `User-Agent: TaoCoder/<ver>`, `X-PLATFORM` (vscode appName), `X-PLATFORM-VERSION`, `X-CLIENT-TYPE: "VSCode Extension"`, `X-CLIENT-VERSION`, `X-CORE-VERSION` (ext@8484388, ext@22578532).

`clientId` is a random UUID v4 created when the service object is constructed (`Rse=eGl`, ext@7729951), so it is new each session. **No machine id, hostname or workspace data** appear in this module.

| Endpoint | Sent | Received | When called |
|---|---|---|---|
| POST `/api/auth/login`, `/register` | email, password (+displayName) | tokens, user | login form (wv@150641 → ext@22627748) |
| POST `/api/auth/refresh` | refreshToken, clientId | new tokens | on 401, or when no access token is stored |
| POST `/api/auth/revoke` | — | — | logout |
| GET `/api/auth/me`; POST `verify-email`, `forgot-password`, `reset-password`, `resend-verification` | token / email / newPassword | user / — | account flows |
| **GET `/api/subscription/status`** | — | id, planName, status, launchCount, maxLaunches, trial/end dates | **on every `getStateToPostToWebview`** (ext@21077900) and in the account view |
| **GET `/api/notifications/unread-count`** | — | count | **on every state post** (same place) and in the notifications view |
| GET `/api/notifications?limit&offset&read` | — | id, userId, type, title, message, data, read, emailSent, createdAt, readAt | notifications view (wv@4484015) |
| POST `/api/notifications/{id}/read`, `/read-all` | — | — | user action |
| GET `/api/subscription/history`, `/api/plans`, `/api/config/contacts`; PATCH `/api/user/profile` | displayName (PATCH) | launches; plans (price, maxLaunches, trialDays, features); email, telegram | account view (wv@4467481) |
| **POST `/api/launch`** | `{modeId}` | launchToken, expiresAt | see below |

**Tokens** live in `secrets.json` (`taocoderAccessToken`/`taocoderRefreshToken`); the webview holds them in memory only. Refresh first re-reads the file in case another window refreshed; 401/403 on refresh clears them (ext@~16104600).

**When `/api/launch` is called.** Once per **new task** whose role mode is *not* one of `developer, architect, ops, free, debug, task` (`$c`, ext@8541892 with `Wcd`, ext@8541962). There are two call sites: `newTask` (ext@20864987) and `ScheduledRunLauncher` (ext@21362895).
- The four shipped JSON modes (`mode-builder`, `taocoder-guide`, `tao-coder-dev-guide`, `manage-connections`) are not in that set, so they **are launch-gated** [code + inf].
- Built-in modes, resumes, self-delay continuations and handoffs to Developer do not call `/api/launch`.
- The token goes to `task_context.json` (`launch_token`, `launch_expires_at`); the audit log keeps a 20-char prefix (ext@8797908). Nothing else reads it.

```
launch(mode):                          # ext@~16109500
  try POST /api/launch {modeId}
  except: type = 401|INVALID_LAUNCH_TOKEN→auth, 402|LAUNCH_LIMIT_EXCEEDED→limit,
                 403|SUBSCRIPTION_INACTIVE→subscription, 5xx→server
  throw Error("TAOCODER_LAUNCH_ERROR|type|msg")   # task is not created
```
**What the user sees** (wv@3538648):
- **Chat start:** modal "Launch Limit Reached" (upgrade or wait for next billing cycle), "Subscription Inactive" (renew), "Authentication Required" (login) or "Server Error" (retry).
- **Scheduled run:** a modal saying `Scheduled run "<name>" was skipped: …` with buttons "Sign In" / "Manage Subscription". It is shown at most once per schedule per 10 minutes (`M9c`, ext@~21369300).

**Before login** `authenticatedRequest` throws before any network call, so unauthenticated users generate no vendor traffic. [inf] Logged-in users make two GETs per state post.

## 3. Other network endpoints and telemetry

**New hosts compared with all three upstream builds:** `api.taocoder.thinkingos.tech`, `api.neuraldeep.ru`, `api.siliconflow.com`, `dashscope-us.aliyuncs.com`, `cn-hongkong.dashscope.aliyuncs.com`, `api.tavily.com`, `google.serper.dev`, `api.search.brave.com`, `api.typesafe.ai`, `thinkingos.tech` (referer only).

**Telemetry**
- PostHog keys and OTel switches come **only from `process.env`** (`bR`, ext@10455951); upstream bakes in `phc_…` keys (u3.84.0@9834969). [inf] So no provider is created; if set, events go to Cline's `data.cline.bot`.
- `updateTelemetrySetting` starts with `if(!!1){ setGlobalState("telemetrySetting","disabled"); return }` (`27_webview_ui_glue.js @21051190`); the default stays `"unset"`.
- The banner fetch to `api.cline.bot/banners/v2/messages` is inherited but gated by PostHog flag `remote-banners` (ext@10604851). [inf] With no keys it is effectively off.
- No TAO analytics service exists. No TAO update check exists beyond the Marketplace.

**Leftover debug beacon (new).** 11 calls to `fetch("http://127.0.0.1:19345/event",…).catch(()=>{})` in `attemptApiRequest`, history building and `presentAssistantMessage` (ext@20944177, ext@21004728). They send tool name, **file path** and timestamps on every tool call, plus error messages; localhost only.

**TaoBridge.** Zero references in the extension or the webview. It appears only in the leftover test scripts (§7).

**Web search** (`ZPc`, ext@20789747; settings `Von`, ext@~7734500)
- Providers: `tavily` (default, ext@7705116), `serper`, `brave`, or a `custom` endpoint (HTTPS, or HTTP to localhost), which receives both `Authorization: Bearer` and `X-API-Key`.
- 10 results, 15 s timeout. Keys come from the secrets `taoCoderWebSearch*ApiKey`; search is "ready" only when the key exists.
- Web tools are on by default; `web_fetch` is a local fetch, not Cline's backend.

**JEV.** `https://api.typesafe.ai/v1/decisions` or `https://openrouter.ai/api/v1/decisions`, or a custom `taoCoderJevEndpoint`; key in `taoCoderJevApiKey`; default off (ext@20492903, ext@20564656).

**LLM request headers.** `HTTP-Referer: https://thinkingos.tech` + `X-Title: TAO·CODER` only on Cline (plus `X-Task-ID` and `$k`, ext@12603837), OpenRouter (ext@13967440), Requesty (ext@13980708), Vercel (ext@15263909) and Z AI (ext@15416060).

## 4. Providers and models
- **Two new providers** (diff of `case"…":return new` against u4.0.12):
  - **NeuralDeep:** `https://api.neuraldeep.ru/v1`; default model `gpt-oss-120b`; model list cached in `neuraldeep_models.json`; sends `reasoning_effort` via `extra_body` (`13_providers_models.js @13489621`).
  - **SiliconFlow international:** `https://api.siliconflow.com/v1`; default `Pro/deepseek-ai/DeepSeek-V3` (ext@15256355).
- **DeepSeek provider narrowed.** Its catalogue `Krt` now holds one model, `deepseek-flash` ("DeepSeek V4.1 Flash — 552B MoE", 1M context, $0.15/$0.60, cache read $0.003; **peak** prices $0.30/$1.20 at UTC hours 1–4 and 6–10, Monday to Friday) (ext@7629351). `getModel` throws on any other id (`13_providers_models.js @12609929`); `deepseek-v4-*` ids get reasoning handling (@12608298).
- **Qwen (DashScope) catalogue extended** in both region tables (ext@~7635000–7656000): `qwen3.5/3.6/3.7/3.8-{plus,flash,max}` with dated variants, `qwen3-max`, `qwen3-vl-*`, `deepseek-v4.1-flash[-1017]` (peak UTC 0–14 every day), `deepseek-v4-flash-0731`, `glm-5.3`. New regions `us` and `hongkong` (ext@13972311).
- **Cost calculation** (`c4n`, `@11923285`): peak prices apply when the UTC day and hour fall in `peakDays`/`peakHours`.
- **Default provider** `openrouter`, as upstream (`fon`/`HVr`).
- **No gateway.** `taoai`, `llmhub`, `api.taoai.ru` and `taobridge` appear **nowhere** in either bundle.

## 5. REST API hub
**Config files**
- Global: `~/.cline/data/settings/cline_rest_api_settings.json` (`ua.restApiSettings`, ext@8859771).
- Workspace: `<repo>/.taocoder/rest_api_settings.json` (`gcd`, ext@~8505150).
- The two are merged with workspace entries overriding global ones, and watched with chokidar.

**Schema** (zod, ext@16064599):
```
{restApiServers:{<name>:{baseUrl:url, endpoints:[{name, method:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS,
  path, description?, queryParams?:[{name,description?,required?}]}], headers?:{str}, timeout=30,
  disabled?, remoteConfigured?, scope:user|workspace, description?,
  oauth?:{authorizationUrl, tokenEndpoint, scopes[], clientId?, clientSecret?},
  validationStatus:valid|invalid|unknown}}}
```

**OpenAPI import** (TAO's own code, ext@~16077000–16082500; no swagger-parser)
- Input: URL, local file or inline text; JSON or YAML; OpenAPI 3.0.x and Swagger 2.0 only.
- Endpoints are named by `operationId` or method + PascalCase(path); only query parameters are kept, no request bodies.
- Dead code: normaliser `IIr` (output unused) and `executeWithRetry` (never called).

**`use_rest_api` flow** (ext@20758852):
```
args = JSON.parse(arguments); args = resolveSecrets(args) or error
approve unless shouldAutoApproveRestApi(server, endpoint); run PreToolUse hooks
hub.executeEndpoint(server, endpoint, {pathParams, queryParams, body}):
    headers = resolveSecrets({...server.headers})       # missing key → warn only
    GET cache hit (5 min TTL, 100 entries, LRU; bypassed by Cache-Control: no-cache) → return
    client.execute: fetch(baseUrl+path, timeout*1000 ms); body capped at 100 KB;
                    OAuth adds Bearer token; 401 → oauthRequired
output "Status: …\n\n"+body → spill copy to $TMPDIR/taocoder-rest-api-spills/rest-api-<ts>.txt (400 KB cap)
```
MCP tool output is spilled the same way to `taocoder-mcp-spills`. [inf] Response data persists in `/tmp`.

**`manage_connections`** (ext@20763228). Actions: `list | test | add | update | remove | toggle | set_secret`, for connection type `mcp | rest`.
- `list` returns placeholder key **names** only (`secretKeyNames`).
- `add`/`update` first ask for any missing placeholder secrets (`collectMissingSecrets`).
  - REST: `addServer` writes the settings file and then runs a live health check `GET /`.
  - MCP: `writeMcpConfig` calls only `mcpHub.updateServerConnections` (ext@~20771500). [inf] Servers added this way are connected but **not written** to `cline_mcp_settings.json`.

## 6. Triage of the `other` chunks (03–12)
**Third-party code TAO added** (each absent from u4.0.12):
- **MCP TypeScript SDK v2 client** (`@modelcontextprotocol/client` 2.3.x, protocol `"2026-07-28"`, `SdkHttpError`; ext@~15700000–16010000), used by McpHub: `new u$u({name:"Cline"…},{versionNegotiation:{mode:"auto"}})` (ext@16037716). It brings a second zod v4 copy (`_zod` 1148 vs 610), Ajv 2020 meta-schemas and **eventsource-parser** v3 (ext@~15922051).
- **luxon** (ext@~21269000–21344000) and **cron-parser** (`Invalid cron expression`, ext@21353097) for the scheduler.
- **ts-proto** generated encoders and decoders for TAO's own gRPC messages (≈0.75–2.25 MB, `decode(t,e)` units).

**TAO code found there, not covered elsewhere:** the localhost beacon (§3); a 300 s provider first-chunk timeout (ext@20962701) and `COMMAND_KILL_SWITCH` (ext@20565755); `/tmp` spill files; `<file>.lock` locks (`pid:timestamp`, stale after 10 s, ext@22590344); background-task restore (ext@21050166); orphaned task-context adoption (ext@8509356); `[CrashAnalyst]` (ext@20969285); "Fix with TaoCoder" code actions (ext@22645890).

## 7. Shipped files outside `dist/` that look like leftovers
| File | What it is |
|---|---|
| `test-taobridge-connection.mjs` | MCP test for `https://taobridge.thinkingos.tech/.well-known/mcp/` with a **hard-coded `X-Api-Key`** (not reproduced) |
| `test_mcp_handshake.mjs` | handshake test for `…/admin/mcp/`; key read from `/Users/maxzhadobin/TaoAI_TRAE/TaoBridge/mcp_admin.json` |
| `debug-custom-secrets.js` | diagnostic for a custom-secret persistence bug; requires `./src/...` |
| `Oops.rej` | rejected patch hunk of a Controller test |
| `.mocharc.single.json`, `test-storage`, `package.json.openvsx` | mocha config, dummy JSON, alternative manifest |
| `pwa/`, `pwa-server/` | "Каркас/прототип. Не работает end-to-end" mobile PWA (React plus a `ws` server); not in the bundle |
| `bin/terminal-notifier.app.broken`, `bin/terminal-notifier.zip` | broken copy and archive of a macOS notifier |
| `webview-ui/tailwindcss-34316.log`, `tailwindcss-35944.log` | 195,548 B each; plus `tailwind.config.mjs` and tsconfig files |

## Corrections to ANALYSIS.md
1. **§4/§7, Secrets.** `~/.cline/data/secrets.json` (0600, movable via `CLINE_DIR`) and the copy-without-delete migration are **upstream Cline ≥3.78 behaviour**, not a TAO choice. TAO added custom keys, 100 ms polling sync and placeholders. The site's "SecretStorage" claim is still wrong for 3.1.2.
2. **§4, "auto-scrubbed."** Only partly: written back to disk only on UI save of MCP JSON; on file load only the in-memory copy is scrubbed; REST `oauth.clientSecret` never is.
3. **§4, "resolved before execute_command."** Also MCP connect config, MCP tool args, REST headers and `use_rest_api` args; a missing REST secret only warns; command output is not masked.
4. **§7, Telemetry.** Also: changing the setting forces "disabled"; a debug beacon to `127.0.0.1:19345` carries tool names and file paths.
5. **§7, Subscription.** `/api/launch` runs per **new task in a non-built-in mode** (incl. the 4 shipped JSON modes), not per request. Logged-in state refreshes also poll `subscription/status` and `unread-count`.
6. **§7, Headers.** `HTTP-Referer`/`X-Title` are added only on the Cline, OpenRouter, Requesty, Vercel and Z AI providers.
7. **§7, Leftovers.** Add `pwa/`, `pwa-server/`, `terminal-notifier.app.broken`, `test_mcp_handshake.mjs`, `.mocharc.single.json`, `test-storage`, `package.json.openvsx`; the tailwind logs are **two** files of 195,548 B.
8. **Providers (new).** NeuralDeep and SiliconFlow-international added; DeepSeek cut to one peak-priced model; Qwen extended; no TaoAI/LLMHUB gateway.
