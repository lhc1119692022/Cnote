# 视频生成渠道与模型目录

## 关系

视频生成渠道不是只保存一个 URL。一个渠道实例保存以下四类信息：

- `presetId` / `presetVersion`：它来自哪套文档预设。
- `baseURL`：预设提供默认值，但始终允许用户修改中转站地址。
- `modelCatalog`：该预设已知模型的 UI 元数据，包括名称、时长、分辨率、画幅、参考素材数量和生成音频能力。
- `videoRequestContract`：创建、轮询、下载路径以及请求字段名。它决定 `seconds` 与 `duration_seconds`、参考图片字段和音频字段等差异。

视频节点只选择“渠道 + 模型”。节点从渠道的 `modelCatalog` 读取已知模型能力，不直接依赖一个全局视频模型表；通过接口拉取但未被预设收录的新模型仍会显示在模型列表中。未知视频模型采用宽松默认档案：开放文本生成、图片/视频/音频参考、首尾帧、视频编辑和生成音频，提供全部通用视频参数，不设置参考素材数量上限，并放宽客户端对时长、分辨率和画幅的阻断式校验。这样即使档案尚未更新，也不会因为漏配能力而把 UI 或请求拦掉；真实不支持的参数由中转站返回错误。

两个视频预设会像文本渠道中的官方渠道一样，首次进入生成渠道设置时直接初始化为两张可编辑的渠道卡片，不通过新增渠道对话框中的额外预设菜单选择。用户可以直接编辑它们的 API 地址、API Key 和模型列表，也可以删除后创建自定义生成渠道。

## 当前预设

- `video-808relay`：对应 808Relay 视频调用文档，默认地址为 `https://api.808relay.com`，包含文档确认的六个模型，使用 `seconds`、`reference_images`、`generate_audio` 等字段。
- `video-kacang`：对应在线公开目录 `https://newapi.prompt-hubs.com/docs` 的 `2026-09-19.008` 版本，默认地址为 `https://newapi.prompt-hubs.com/v1`，预设包含当前二十二个视频模型。MiniMax/S 使用公开 snake_case 参考字段；Doubao 使用 `start_frame` / `end_frame`、`reference_images` / `video_references` / `audio_reference`；Grok 使用 `image` 首帧及 `images` 参考图。旧 camelCase 是服务端兼容别名，不再作为新请求的首选格式。

两套预设均为视频专用，默认不提供图片生成能力。`baseURL` 不是不可变配置；用户可以直接编辑它，模型 ID 也可以继续通过“拉取模型”或手动输入扩展。

## 新增模型或渠道

视频文件规格由独立官方模型档案决定，见 `docs/video-media-validation.md`。同一个底层模型复用文件检查规则；明确记录在渠道合同 `referenceLimits` 中的限制与官方数量限制取交集，不能被通用模型能力重新放开。历史目录的旧数量不自动成为渠道硬限制。新增已知模型别名时同步维护 `official-media-rules.ts` 的映射，不修改请求模型 ID。渠道合同负责请求字段、地址、轮询、成对帧和条件限制。

`kacang-public-catalog.ts` 是经过筛选的公开参数快照，不在运行时下载或执行远程文档。已确认模型在模型列表、合同查询及提交时都会按渠道解析，因此已保存的旧目录与新拉取的模型也会更新；旧版本特有 ID 继续使用历史目录，不替换用户的模型列表或密钥。渠道隔离按选中的协议执行，不能把同名模型的 Kacang 字段套到 808Relay。详细来源、差异及未证实项见 `video-provider-contract-audit.md`。

优先修改 `web/src/lib/generation/video-catalog.ts`：

1. 添加模型的 API ID 和 UI 名称。
2. 添加文档中的能力、时长、分辨率、画幅和参考素材限制。
3. 如果字段名不同，在该模型上指定 `videoRequestContract`，不要把判断写进节点组件。
4. 将模型加入对应预设的 `models` 与 `modelIds`。

只有当新的平台改变了任务生命周期或响应结构时，才需要扩展 `web/src/lib/generation/client.ts` 的通用合同处理；普通模型增减不需要修改视频节点 UI。

## 素材地址

Kacang 视频预设的文档合同标记为 `requiresPublicHttps`。所有视频渠道现在统一使用自定义媒体存储，不再提供内联提交选项；本地素材先转换为公网 HTTPS 地址。已经是公网 HTTPS 的上游素材可直接引用，不需要再次上传。读取地址必须是媒体 Worker 源站上的完整 HTTP 200 文件；R2 公共开发域名在 Range 请求下会返回 206，Kacang 无法使用。
