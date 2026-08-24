# Seedance 与 MiniMax H3 视频生成渠道

本说明记录生成节点对两类视频渠道的第一版请求适配。附件文档中的示例请求只作为字段依据，不要求用户手工复制命令。

## 卡藏 / NewAPI

统一创建接口为 `POST /v1/videos`，视频请求使用 `video.v1` 协议：

```json
{
  "version": "video.v1",
  "model": "minimax_h3",
  "operation": "image_to_video",
  "prompt": "...",
  "duration_seconds": 4,
  "resolution": "768",
  "aspect_ratio": "16:9",
  "media_inputs": [
    { "kind": "image", "role": "reference", "url": "https://example.com/reference.jpg" }
  ]
}
```

Seedance 与 MiniMax H3 共用 `media_inputs`。节点会把参考文件类型和角色转换为服务端语义：

- 图片：`reference`、`first_frame`、`last_frame`；
- 视频：`source_video`；
- 音频：`audio_reference`。

`operation` 会根据能力和参考素材自动选择 `text_to_video`、`image_to_video` 或 `video_to_video`；首尾帧通过 `media_inputs` 的 `first_frame`/`last_frame` 角色表达。不支持的能力仍然显示在节点中并置灰。

查询视频使用 `GET /v1/videos/{task_id}`。完成响应优先读取 `outputs[0].content_url`、`outputs[0].download_url`，同时兼容 `url`、`video_url`、`result_url` 和 `download_url`。视频内容端点为 `/v1/videos/{task_id}/content`，支持 Bearer 鉴权和 Range 请求。

### MiniMax H3 能力基线

- 模型 ID：`minimax_h3`、`MiniMax-H3-漫剧优化`、`MiniMax-H3-量化版`；
- 时长：4–15 秒；
- 参考图片最多 9 项、视频最多 3 项、音频最多 3 项；
- `minimax_h3` 支持 `768`、`1080p`、`2K`、`4K`；漫剧优化和量化版不展示未确认的 `1080p`；
- 比例支持 `21:9`、`16:9`、`4:3`、`1:1`、`3:4`、`9:16`。

## MEAICC

MEAICC 使用同一 `POST /v1/videos` / `GET /v1/videos/{task_id}` 流程，但请求体是独立的嵌套结构：

```json
{
  "model": "sd-2-c1",
  "input": {
    "prompt": "...",
    "media": [
      { "type": "reference_image", "url": "https://example.com/reference.jpg" }
    ]
  },
  "parameters": {
    "resolution": "720p",
    "ratio": "16:9",
    "duration": 15
  }
}
```

服务端完成状态可能返回大写 `SUCCEEDED`，结果地址位于 `object` 字段；失败状态可能是 `FAILED: 原因`。节点会统一映射为 Cnote 的完成/失败状态，并保留原始任务 ID。

## 本地文件与长任务

以上渠道要求服务端可匿名读取的 HTTPS 参考地址。节点仍会保存本地文件、显示缩略图、支持排序和按图片/视频/音频分栏，但在没有上传服务时标记为“待上传”，提交前阻止隐式失败。

图片任务默认等待窗口为 15 分钟，视频任务为 60 分钟。超时只停止轮询，不重复提交；用户可以使用同一个 `task_id` 继续查询。成功结果会自动创建下游图片或视频内容节点，并将二进制内容保存到本地资源存储。
