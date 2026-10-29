# 手机端客户端配置

给安卓手机用的两份点播源配置，内容等价于本机 `.env.local` 里的 `DEFAULT_SOURCES`
（光速 / 暴风 / 量子 / 360），已在本机 LibreTV 实测可搜可播。

| 文件 | 用于 |
| --- | --- |
| `tvbox.json` | [FongMi/TV（影视TV）](https://github.com/FongMi/TV) 的「配置地址」 |
| `sky-tv-sources.json` | [sky-tv](https://github.com/sky23333/sky-tv) 的影视源订阅 |

FongMi 的苹果CMS 站点 `type` 必须是 **1**（JSON HTTP）；`type: 3` 是 Spider
（JAR/JS 爬虫），填错会导致站点打不开。

加载后配置会存在手机本地，之后即使链接失效也能继续用；更新源时再取一次即可。
