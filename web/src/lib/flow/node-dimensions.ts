// The browser is a working node inside a flow, not a full-window preview.
// Keep its default footprint comparable to the other node types so native
// browser content cannot cover neighboring nodes and their menus.
export const BROWSER_NODE_DEFAULT_SIZE = { width: 920, height: 620 } as const
export const BROWSER_NODE_MIN_SIZE = { width: 680, height: 460 } as const
export const AI_NODE_DEFAULT_SIZE = { width: 460, height: 510 } as const
export const AI_NODE_MIN_SIZE = { width: 460, height: 340 } as const
export const AI_NODE_MAX_AUTO_HEIGHT = 960
export const REQUEST_NODE_DEFAULT_SIZE = { width: 540, height: 430 } as const
export const REQUEST_NODE_MIN_SIZE = { width: 540, height: 430 } as const
export const CONTENT_NODE_DEFAULT_SIZE = { width: 540, height: 430 } as const
export const CONTENT_NODE_MIN_SIZE = { width: 420, height: 300 } as const
export const AUDIO_NODE_DEFAULT_SIZE = { width: 540, height: 220 } as const
export const AUDIO_NODE_MIN_SIZE = { width: 420, height: 200 } as const
export const STICKY_NODE_DEFAULT_SIZE = { width: 300, height: 240 } as const
export const STICKY_NODE_MIN_SIZE = { width: 240, height: 210 } as const
export const CONTENT_MEDIA_MAX_AUTO_HEIGHT = 640
export const ONLINE_VIDEO_MAX_AUTO_HEIGHT = 720
export const ONLINE_VIDEO_PORTRAIT_MAX_AUTO_HEIGHT = 1080
export const ONLINE_VIDEO_TRANSCRIPT_MAX_HEIGHT = 288
export const GROUP_NODE_PADDING = 48
