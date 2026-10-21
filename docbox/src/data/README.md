# 内置数据说明

| 文件 | 用途 | 来源 |
| --- | --- | --- |
| `rdap/dns.json` `rdap/ipv4.json` `rdap/ipv6.json` | RDAP 引导表：域名 TLD / IP 段 → 权威 RDAP 服务器 | IANA（<https://data.iana.org/rdap/>），公共数据，随发行版打包；启动后超过 30 天会后台自动刷新 |
| `subdomains.txt` | 子域名枚举的内置字典（默认全量，可按 500 / 2000 / 5000 分词取用） | 本项目自建常用子域名字典（通用 IT 命名，无第三方授权问题） |

## 想用自己的字典

把每行一个子域名的文本放到 `src/data/subdomains-extra.txt`，工具会把内置字典和它合并使用（同名去重）。也可以只走「证书日志」模式，完全不依赖本地字典。
