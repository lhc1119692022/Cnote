# 808 视频生成渠道（`sd2-5-720p`）

本文件是 Cnote 生成节点对 808 Relay 的第一版适配说明。附件
`D:/Desktop/video/808/sd2-5-720p-30秒多参考视频API调用文档.md` 是协议来源；其中的示例 cURL 和提示词只用于验证字段，不作为用户必须照抄的操作步骤。

## 接口

- Base URL：`https://api.808relay.com`
- 创建任务：`POST /v1/videos`
- 查询任务：`GET /v1/videos/{task_id}`
- 结果内容：`GET /v1/videos/{task_id}/content`
- 模型：`sd2-5-720p`
- 模式：`reference-to-video`
- 默认时长：30 秒
- 默认分辨率：720p

请求体由视频生成节点的配置和参考资源适配生成：

```json
{
  "model": "sd2-5-720p",
  "seconds": 30,
  "resolution": "720p",
  "mode": "reference-to-video",
  "prompt": "...",
  "image_urls": [],
  "video_urls": [],
  "audio_urls": [],
  "generate_audio": true
}
```

提示词中可以使用 `@image1`、`@video1` 等占位符引用排序后的参考文件。文档验证了 3 张图片和 3 个视频的组合，但没有声明硬上限，因此 Cnote 不把 `3/3` 固定为最大值；超出服务端实际限制时显示服务端错误。

## 参考文件

808 要求参考地址为无需登录的公网 HTTPS 直链。当前 Cnote 尚未为 808 提供本地文件上传服务，因此：

- 本地文件仍可在节点内预览、排序和保存；
- 文件会显示“待上传/当前渠道不支持本地直传”；
- 提交前会阻止没有公网 HTTPS 地址的参考文件；
- 用户替换为直链后可以继续提交。

视频节点的图片、视频、音频参考文件在界面中分栏显示，提交时分别转换到 `image_urls`、`video_urls` 和 `audio_urls`。

## 状态与轮询

服务端状态映射：

| 808 状态 | Cnote 状态 |
| --- | --- |
| `queued` | 排队中 |
| `in_progress` | 生成中 |
| `completed` | 已完成 |
| `failed` | 失败 |

默认轮询间隔为 10 秒，建议等待窗口为 60 分钟。节点持续显示已等待时间，超过窗口后显示明确的超时提示，同时保留 `task_id`。超时不会自动重复提交；用户可以点击“继续查询”。

结果地址按以下顺序兼容：

```text
url
result_url
video_urls[0]
metadata.url
metadata.result_url
```

任务成功且得到有效 URL 后，视频生成节点会在右侧自动创建一个视频内容节点，并建立连接。重复查询或重复执行会更新已有结果节点，不会重复创建。

## 后续待补齐

- 808 本地文件上传/临时公网 URL 服务；
- 取消任务接口（文档暂未确认）；
- 结果内容端点返回二进制时的本地资源落盘；
- 服务端真实参考文件数量限制的能力同步。

