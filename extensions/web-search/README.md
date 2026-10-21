# Web Search

Searches the web through Tavily first. If Tavily returns its confirmed
quota-exhaustion response (HTTP 432 with its usage-limit message), the
extension uses the local SearXNG instance for that search and all later
searches in the same Pi process.

Other Tavily failures—including missing credentials, authentication problems,
and temporary network or service errors—remain errors and do not trigger a
fallback.

## Tavily credentials

The extension checks these locations, in order:

1. `TAVILY_API_KEY` environment variable
2. `auth.json` next to the extension, using `{ "tavily_api_key": "..." }`
3. `~/.config/tavily/api-key` (a plain text file containing only the key)

The token is intentionally kept outside this repository.

## SearXNG fallback

By default the fallback uses the local SearXNG JSON API at:

```text
http://127.0.0.1:8888
```

Set `SEARXNG_URL` to use another absolute `http` or `https` base URL. It must
not contain credentials, a query string, or a fragment. A path prefix is
supported; for example `http://localhost:8080/searxng/` uses
`http://localhost:8080/searxng/search`.

The SearXNG instance must enable JSON output in its `settings.yml`:

```yaml
search:
  formats:
    - html
    - json
```
