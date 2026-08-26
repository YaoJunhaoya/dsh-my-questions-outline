// dsh-my-questions-outline — Host 半部（ESM）。
// 这是一个纯客户端（Web）插件：识别提问、侧边栏渲染、滚动定位、本地持久化
// 全部在 lib/client.js 里完成（经 dsh.client bundle 注入浏览器）。
// 宿主侧只需要声明插件身份，使其进入 cordis 加载器并被 dsh.client 扫描到即可。

export const name = "dsh-my-questions-outline";

export function apply() {
  // 宿主侧无需任何动作。
}
