/**
 * video-frame.spec 的密闭化前置：必须在 media-input 被导入前加载。
 * media-input 的隧道真源在模块导入期一次性求值：
 *   TUNNEL_URL_FILE = process.env.YIMU_TUNNEL_URL_FILE || cwd/.tunnel-url
 * 开发机仓库根常有运行中的 .tunnel-url（隧道每次重连换域名），
 * 会压过用例里 delete YIMU_PUBLIC_MEDIA_BASE 的前提。这里把隧道文件
 * 指到不存在的路径，模拟「无隧道」环境；不影响任何其它用例
 * （jest 按文件隔离模块注册表，该变量只有 media-input 消费）。
 */
process.env.YIMU_TUNNEL_URL_FILE = '/nonexistent/yimu-test-no-tunnel-url';
