# DayBoard 1.2.4

- Improved: The Assistant sends the unchanged part of each request first, so AI providers that support prompt caching can reuse it.
- Improved: Each AI request records the tokens it used, including cache reads and writes when the provider reports them.
- Fixed: Assistant requests no longer send your question and DayBoard's agenda snapshot as two separate messages, which some providers reject.
- Fixed: The context meter no longer drops to zero for Claude Code replies that leave out cache counts.
- Fixed: Direct OpenAI requests always go to OpenAI, even when an `OPENAI_BASE_URL` setting is present.
- Improved: Built for Glaze 0.14.3.
- The Store listing now links to the standalone DayBoard Mac app at https://getdayboard.com/.
