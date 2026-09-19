# 视频渠道请求契约核查（2026-09-20）

## 一手来源

- Kacang：<https://newapi.prompt-hubs.com/docs>，公开目录版本 `2026-09-19.008`。核查服务端 HTML 的模型说明、参数表、公开 wire 字段和 `publicCatalog` JSON 数据；没有执行网页脚本。当前目录有 22 个视频 ID。
- MiniMax 官方 H3：<https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md>，原生 `POST /v2/video_generation` 的 OpenAPI。
- 808Relay：<https://api.808relay.com/docs> 与 <https://api.808relay.com/api/docs>（`contract_version=1`）。后者的自动模型目录与完整示例存在差异，不能把通用自动目录当作完整素材合同。
- Wan 3：此前用户提供的 `D:\Downloads\wan-3.0-视频API调用文档.md`，与当前适配交叉比对。808Relay 在线自动条目不足以独立证明所有 Wan 视频字段。

以上均为不带密钥的文档读取，没有提交付费生成任务。模拟测试证明客户端如何构造请求，不等于远端所有线路已实测成功。

## 已确认并修正

| 对象 | 证据与行为 |
| --- | --- |
| S / sd / Seedance | 复用 Seedance 文件规格；新增在线目录的 `S-2.0官转933-线路三` 别名。底层模型别名不改变实际请求 ID，也不跨渠道复制 wire 字段。 |
| Kacang H3 / S | 新客户端使用 `reference_images`、`reference_videos`、`reference_audios`；只配置各条目已公开的字段。旧 camelCase 仍是兼容别名，不能把它本身说成失败原因。更新当前 22 个模型的时长、画幅、分辨率和已确认参考数量，解析覆盖已保存目录。 |
| Kacang Doubao 2.0 / 2.5 | `start_frame` 与 `end_frame` 必须成对，与参考媒体互斥。多模态一张图仍是 `reference_images`，首尾帧单张图则在上传前拒绝。 |
| Kacang S-2.0mini-线路三 | 明确不接收视频参考；480p 最长 15 秒，720p 最长 12 秒。官方通用档案不能重新开放该渠道的视频输入。 |
| Kacang S-2.0-933-线路六 | 固定 15 秒，至少一张参考图，提示词最多 5000 字。不能因为通用 Seedance 支持文生视频就发送空参考。 |
| Kacang S-2.5-301010-25 秒-线路三 | 生成时长 4–25 秒，不能沿用旧条目的 30 秒。 |
| Kacang S-2.5-九图-线路三 | 最多九张图片，不能被通用 Seedance 2.5 的 30 图上限覆盖。 |
| Kacang Grok 三个公开 ID | `image` 是首帧，`images` 是参考图。多模态单张图必须走 `images`，仅显式首尾帧入口使用 `image`。未公开尾帧字段，不冒充支持。参考图模式 1080p 会被服务端降档，客户端要求用户明确改为 480p/720p，不悄悄降画质。 |

公开目录说明“未列出的字段和值不代表不可用”。快照中的明确数量、固定值和服务端约束可以硬校验；未确认的分辨率集合仍允许自定义。缺少字段映射表示客户端尚不能可靠表达对应角色，不表示已证明模型本身不支持。旧版本特有模型 ID 保留历史适配，不假称已获得当前文档认证。

## H3：模型能力与中转合同必须分开

官方 H3 V2 用 `content` 数组和显式 `role`：参考图为 `reference_image`，首尾帧为 `first_frame` / `last_frame`。单张图片省略角色会默认作首帧，因此原生适配也必须保留“参考”语义。官方 H3 与 H3-Max 有各自的时长、分辨率要求，不能拿原生模型名替换 Kacang 的 `minimax_h3` 和线路变体。

当前 Kacang H3 的公开合同列出参考字段，没有确认首尾帧字段或官方 `content` 的透传。S 的部分线路还明确排除了 `first_image`、`last_image`、`first_frame_url`、`last_frame_url`。所以不能把另一渠道的 `input_reference` / `image_end` 或原生 H3 的 `content` 猜填进去。具备官方文件档案与已知参考字段的组合已验证；缺少首尾帧合同的组合仍在上传前说明缺口，不偷偷改成参考图。要解除此缺口，需要渠道提供该线路的成功首尾帧请求示例或明确合同。

## 808Relay：核查结论及未证实项

- Seedance：公开页面示例包含 `text_to_video`、`image_to_video`、`first_last_frame`、`multi_ref`。保持模式显式分流；多模态的图片、视频、音频组合均不能路由到首尾帧。在线自动模型条目仅覆盖部分字段，历史参考数组与所有线路的兼容性尚未通过真实请求证明。
- Wan 3：用户给出的专用视频文档对应 `duration`、`image_urls`、`video_urls`、`audio_urls`，与现有修正一致；不是把 Seedance 的 `mode` 套上去。在线自动目录同时出现 `/v1/videos` 与聊天 `messages`，信息不完整，不据此改成聊天接口。
- `gemini-omni-1.1`：在线自动目录同样存在视频端点与聊天场景的矛盾，未取得完整模型级视频素材合同。新公开的 `omni_guide` 针对 `omni-flash`、`omni-flash-components`、`omni-flash-edit`，不是这个 ID 的协议证明。不能宣称当前 Gemini Omni 适配已全部认证，也不能静默换成这些模型。

## 回归覆盖

- 28 个当前预设模型的参考组合和首尾帧路径；合法组合核对实际模拟请求体，限制或缺失字段组合核对上传前报错。
- Grok 单图参考 / 单首帧 / 不明尾帧；H3 旧错误映射修正及三类参考字段；Doubao 单帧拒绝、成对帧成功。
- S mini 两种分辨率边界与视频禁用；S 线路六必填参考 / 固定时长 / 提示词限制；S 2.5 的 25 秒与九图上限。
- 真实 store 的旧目录修正、新拉取 ID 识别及协议隔离；纯文件规格与渠道附加限制同时保持。
