# 视频渠道请求契约核查（2026-09-20）

## 一手来源

- 用户补充 `D:/Desktop/视频模型调用文档(1).md`（文档日期 2026-09-07）、`D:/Desktop/sd2-5-720p-30秒多参考视频API调用文档.md`、`D:/Desktop/wan-3.0-视频API调用文档.md`。以下最新结论优先于后文基于旧自动目录及错误响应的历史记录。

## 补充文档后的修正

- Kacang 任务 `task_EzSV1Kf0h5LbjXAqstKD9rNwjNLRetJp` 的本地诊断记录为 `S-2.5-301010-内置过脸`、5 秒、720p、9:16、HTTPS 图片及音频各一项；发送字段包含 `duration_seconds/reference_images/reference_audios`，无首尾帧或 mode。2026-09-20 重新读取 Kacang 该型号公开文档，字段一致，但上游返回 `710082041` 并追问时长和素材。现有记录不足以判断远端下载或内部转发是否成功，不能归因为客户端漏填。需要提供商核对该任务实际素材下载、下游请求及生成工具调用。另修正该旧型号不支持参考视频的已确认限制；该限制与本次一图一音频失败无关。

- 六模型接口中的四个 Seedance ID 省略 `mode`，让参考字段或首尾帧字段决定模式。单张 `reference_images` 仍是参考图。原 `reference-to-video` 也是文档允许值，因此仅凭文档不能判定它是此前混帧报错的根因；如果推荐请求仍报混帧，需要提供商检查参考字段到官方 `content[].role` 的转换。
- `sd2-5-720p` 专用参考请求使用 `image_urls/video_urls/audio_urls` 和 `reference-to-video`。不重复发送另一套别名。该专用文档没有新增首尾帧合同证明，现有首尾帧兼容路径不能据此宣称已获端到端验证。
- `wan-3` 改用六模型标准字段、2–30 秒、480p/720p/1080p；`wan-3.0` 保留 `duration` 与 URL 数组，添加最多两图、720p 的渠道限制。尚未确认接口归属的改名保留原兼容合同，不扩散这两条互不相同的限制。
- 三份文档均没有定义 `omni_reference_task_type`。官方该可选字段不能直接当作 808 `/v1/videos` 的模式开关；没有添加未经提供商确认的透传字段。
- 回归覆盖四个 Pro/Fast/Mini 文档 ID、省略 mode 的所有素材组合、sd2-5-720p 的三类 URL 数组、首尾帧隔离、旧目录修正与 Kacang 隔离。新增 Wan 两条接口的字段差异和超限提交前拦截。模拟验证不证明远端任务成功。

## 早期核查来源与记录

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

- Seedance：此前错误地将页面示例的 `text_to_video`、`image_to_video`、`first_last_frame`、`multi_ref` 视为通用请求枚举。用户提供的 `sd2-5-720p` 真实失败响应明确列出允许值：`auto`、`text-to-video`、`image-to-video`、`reference-to-video`、`start-end-to-video`、`edit-video`、`video-extension`。客户端现按该响应修正：无参考为 `text-to-video`，多模态参考为 `reference-to-video`，显式单首帧为 `image-to-video`，显式双帧为 `start-end-to-video`。这不是新一次真实付费生成的成功证明；其他线路的兼容性仍需端到端验证。
- Wan 3：用户给出的专用视频文档对应 `duration`、`image_urls`、`video_urls`、`audio_urls`，与现有修正一致；不是把 Seedance 的 `mode` 套上去。在线自动目录同时出现 `/v1/videos` 与聊天 `messages`，信息不完整，不据此改成聊天接口。
- `gemini-omni-1.1`：在线自动目录同样存在视频端点与聊天场景的矛盾，未取得完整模型级视频素材合同。新公开的 `omni_guide` 针对 `omni-flash`、`omni-flash-components`、`omni-flash-edit`，不是这个 ID 的协议证明。不能宣称当前 Gemini Omni 适配已全部认证，也不能静默换成这些模型。

## 回归覆盖

- 桌面下载响应含非 Latin-1 响应头时，Electron `net.fetch` 的异步响应回调可能在构造 Web Headers/Response 时抛出 ByteString 异常。桌面网络改用同一 Chromium 网络栈的 `net.request`，在受保护回调中归一化响应头与状态文本，元数据错误只拒绝当前请求；不切换为忽略系统代理的 Node fetch。新增中文文件名响应头、无效头、取消与超时测试。
- 视频总查询窗口仍为 60 分钟，不把 305 秒的服务端生成耗时判成失败。单次状态查询使用 30 秒网络超时，暂时网络故障只重试 GET；查询/下载中断与查询窗口耗尽保留远端任务 ID，进入等待继续查询。历史误记为失败、但具备任务 ID/快照且错误明确为本地网络中断的任务也恢复查询入口；明确的上游失败仍保持失败。恢复测试确认不发送新的生成 POST。

- 用户新增的一图一音频失败响应为 `first/last frame content cannot be mixed with reference media content`。当前客户端模拟请求在 808Relay 的协议、预设和主机识别入口均发送 `reference-to-video`、`reference_images`、`reference_audios`，不含首尾帧字段；这不能证明失败发生时使用了同一请求，也不能证明远端转换正确。在线自动目录未提供该线路完整素材转换合同，尚不能确认上游根因，不凭此猜改字段或自动重试付费生成。请求诊断新增实际提交的模式和素材角色，悬停请求素材摘要可查看不含密钥、提示词或媒体地址的字段摘要。
- 失败运行的空结果占位节点自动移除，连线、选择与结果索引同步清理；保留请求任务错误、已有成功素材和已分离的节点。重新显示请求节点时也清理仍有失败运行记录的历史空占位，错误由运行记录恢复展示。

- 模拟服务端使用用户失败响应中的独立允许值集合校验 `mode`；旧代码先复现相同错误后修复，不再把客户端的下划线模式当作正确答案。核对 808Relay 在线目录中的 17 个 Seedance ID，发现 `high-seedance-*` 漏识别后修复；该组加别名共覆盖 880 条实际模拟请求路径。该模拟检查枚举有效性，不模拟远端排队时序。
- 改为统一系列/版本识别和系列内渠道分支后，新增 284 条“改名后同一模型 × 两渠道 × 旧协议/预设/主机识别 × 素材组合”的请求验证；Kacang 验证自己的实际参考字段、时长字段和首尾帧隔离，不只检查其没有 `mode`。
- 特征识别覆盖供应商前后缀、命名空间、大小写、全角字符、分隔符，以及冲突和未知版本；新增名称不会改变真正提交的模型 ID。H3、Grok、Wan 的改名同样验证各自已配置渠道的字段，不套 Seedance 模式。
- Seedance 系列特征限定为 `seedance`、`doubao`、`sd`、`s`，支持紧凑版本 `20` / `25`；`720` / `1080` 作为分辨率描述，不当作版本号。中文名称、`Jimeng` / `JM` / `DB` / `Seed`、纯数字或描述不作为系列特征，`s2p5` 不识别。独立 `doubao` 别名只确认系列，不据此推断 Kacang 的 Doubao 专用字段；已确认的 `doubao-seedance` 协议分支保持独立。

- 28 个当前预设模型的参考组合和首尾帧路径；合法组合核对实际模拟请求体，限制或缺失字段组合核对上传前报错。
- Grok 单图参考 / 单首帧 / 不明尾帧；H3 旧错误映射修正及三类参考字段；Doubao 单帧拒绝、成对帧成功。
- S mini 两种分辨率边界与视频禁用；S 线路六必填参考 / 固定时长 / 提示词限制；S 2.5 的 25 秒与九图上限。
- 真实 store 的旧目录修正、新拉取 ID 识别及协议隔离；纯文件规格与渠道附加限制同时保持。
