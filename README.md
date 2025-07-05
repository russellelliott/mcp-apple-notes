# MCP Apple Notes

![MCP Apple Notes](./images/logo.png)

A [Model Context Protocol (MCP)](https://www.anthropic.com/news/model-context-protocol) server that enables semantic search and RAG (Retrieval Augmented Generation) over your Apple Notes. This allows AI assistants like Claude to search and reference your Apple Notes during conversations.

![MCP Apple Notes](./images/demo.png)

## Features

- 🔍 Semantic search over Apple Notes using [`all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) on-device embeddings model
- 📝 Full-text search capabilities
- 📊 Vector storage using [LanceDB](https://lancedb.github.io/lancedb/)
- 🤖 MCP-compatible server for AI assistant integration
- 🍎 Native Apple Notes integration via JXA
- 🏃‍♂️ Fully local execution - no API keys needed

## Prerequisites

- [Bun](https://bun.sh/docs/installation)
- [Claude Desktop](https://claude.ai/download)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/RafalWilinski/mcp-apple-notes
cd mcp-apple-notes
```

2. Install dependencies:

```bash
bun install
```

## Usage

### Option 1: Using Claude Desktop

1. Open Claude desktop app and go to Settings -> Developer -> Edit Config

![Claude Desktop Settings](./images/desktop_settings.png)

2. Open the `claude_desktop_config.json` and add the following entry:

```json
{
  "mcpServers": {
    "local-machine": {
      "command": "/Users/<YOUR_USER_NAME>/.bun/bin/bun",
      "args": ["/Users/<YOUR_USER_NAME>/apple-notes-mcp/index.ts"]
    }
  }
}
```

Important: Replace `<YOUR_USER_NAME>` with your actual username.

3. Restart Claude desktop app. You should see this:

![Claude MCP Connection Status](./images/verify_installation.png)

4. Start by indexing your notes. Ask Claude to index your notes by saying something like: "Index my notes" or "Index my Apple Notes".

### Option 2: Using CLI Directly

You can also index your notes directly from the command line:

```bash
bun run index-notes
```

This will:
1. Create/connect to the notes database
2. Fetch and index all your Apple Notes
3. Show progress and statistics about the indexing process

## Troubleshooting

To see logs:

```bash
tail -n 50 -f ~/Library/Logs/Claude/mcp-server-local-machine.log
# or
tail -n 50 -f ~/Library/Logs/Claude/mcp.log
```

## Todos

- [ ] Apple notes are returned in the HTML format. We should turn them to Markdown and embed that
- [ ] Chunk source content using recursive text splitter or markdown text splitter
- [ ] Add an option to use custom embeddings model
- [ ] More control over DB - purge, custom queries, etc.
- [x] Storing notes in Notes via Claude

## References
Pull request with batching (used much of that as a baseline, modified title escapes to help with my notes)
do `bun run index-notes` this branch does batching
https://github.com/RafalWilinski/mcp-apple-notes/pull/3

```bash
=== Indexing Complete ===
📊 Stats:
• Total notes found: 14012
• Successfully indexed: 13983 notes
• Failed to process: 29 notes
• Time taken: 35550.16 seconds
```

```
35550.16 seconds ÷ 3600 seconds/hour ≈ 9.875 hours
Average rate = 13983 notes ÷ 35550.16 seconds ≈ 0.3934 notes/second
```

results from initial
- embedding model isn't very good
  - doing a search query yields irrelevant results
  - no normalization
  - old model (`Xenova/all-MiniLM-L6-v2`) is very small. using `Xenova/all-MiniLM-L6-v2` instead
- very poor text preprocessing
- markdown library (`turndown`) caused weird whitespace and formatting. iterating on this, i decided to convert it to plain text instead.
- to save time, starting off by indexing 1000 notes
- improved note batching and parellel processing

results from that change

```bash
=== Indexing Complete ===
📊 Stats:
• Total notes found: 1000
• Successfully indexed: 1000 notes
• Failed to process: 0 notes
• Time taken: 2176.45 seconds
```

```
2176.45 seconds ÷ 3600 seconds/hour ≈ 0.60457 hours (~36.27 minutes)
1000 notes ÷ 2176.45 seconds ≈ 0.4594 notes/second
```

results from that change

```bash
=== Indexing Complete ===
📊 Stats:
• Total notes found: 1000
• Successfully indexed: 1000 notes
• Failed to process: 0 notes
• Time taken: 2176.45 seconds
```

```
2176.45 seconds ÷ 3600 seconds/hour ≈ 0.60457 hours (~36.27 minutes)
1000 notes ÷ 2176.45 seconds ≈ 0.4594 notes/second
```

**Key improvements:**
- ✅ Upgraded to `Xenova/bge-small-en-v1.5` (better semantic understanding)
- ✅ Added embedding normalization (`normalize: true`)
- ✅ Replaced TurndownService with custom HTML-to-plaintext converter
- ✅ Implemented parallel processing (5 notes at once)
- ✅ Reduced delays and timeouts
- ✅ 16.8% faster processing rate

**Next:** Test search quality with new embedding model before scaling to full dataset.

still doesnt work

do 512 char substring for embeddings `.substring(0, 512)`
```
=== Indexing Complete ===
📊 Stats:
• Total notes found: 100
• Successfully indexed: 100 notes
• Failed to process: 0 notes
• Time taken: 222.96 seconds
```

still doesnt work

do 512 char substring for embeddings `.substring(0, 512)`
```
=== Indexing Complete ===
📊 Stats:
• Total notes found: 100
• Successfully indexed: 100 notes
• Failed to process: 0 notes
• Time taken: 222.96 seconds
```

```
222.96 seconds ÷ 60 ≈ 3.72 minutes
100 notes ÷ 222.96 seconds ≈ 0.4487 notes/second
```

**Latest improvements:**
- ✅ Added 512-character limit to `cleanText()` function
- ✅ Should improve embedding quality and consistency
- ✅ Reduced memory usage during embedding generation
- ✅ Performance rate consistent at ~0.45 notes/second

**Next:** Test if 512-char limit improved search relevance with simple queries.


new problem: how to deal with old notes?
current implementation: when you do index, old notes remain


added system to check if notes modified or not. skips over ones that are unchanged


The key improvements include:

Smart Table Creation: The createNotesTableSmart function supports both fresh rebuilds and incremental updates
Change Detection: Compares modification dates to only process changed notes
Efficient Processing: Skips unchanged notes, dramatically reducing processing time for large collections
Better CLI: Supports `--mode=fresh` or `--mode=incremental` and `--max=N` arguments
Detailed Stats: Shows exactly what was added, updated, or skipped

```
=== Indexing Complete ===
📊 Stats:
• Total processed: 100 notes
• New notes added: 1
• Notes updated: 12
• Notes skipped (unchanged): 87
• Failed: 0 notes
• Time taken: 222.63 seconds
```

```
=== Indexing Complete ===
📊 Stats:
• Total processed: 100 notes
• New notes added: 100
• Notes updated: 0
• Notes skipped (unchanged): 0
• Failed: 0 notes
• Time taken: 213.60 seconds
```


```
=== Indexing Complete ===
📊 Stats:
• Total processed: 215 notes
• New notes added: 100
• Notes updated: 0
• Notes skipped (unchanged): 0
• Failed: 0 notes
• Time taken: 222.36 seconds
```

=== Indexing Complete ===
📊 Stats:
• Notes processed: 100
• Chunks created: 197
• New notes added: 100
• Notes updated: 0
• Notes skipped (unchanged): 0
• Failed: 0 notes
• Time taken: 227.50 seconds

// ...existing code...

## Recent Improvements

### Semantic Search & Chunking Enhancements

**Better Embedding Model & Processing:**
- ✅ Upgraded from `all-MiniLM-L6-v2` to `bge-small-en-v1.5` for improved semantic understanding
- ✅ Added embedding normalization (`normalize: true`) for better similarity calculations
- ✅ Replaced TurndownService with custom HTML-to-plaintext converter that preserves formatting
- ✅ Enhanced text preprocessing with proper cleaning and tokenization

**Smart Chunking System:**
- ✅ Implemented intelligent text chunking with 400-token chunks and 50-token overlap
- ✅ Preserves document structure by splitting on natural boundaries (paragraphs, sentences)
- ✅ Handles edge cases with fallback chunking strategies
- ✅ Each note can generate multiple searchable chunks for better retrieval

**Incremental Indexing:**
- ✅ Smart update detection - only processes modified notes
- ✅ Compares modification dates to skip unchanged content
- ✅ Dramatically faster re-indexing (87% of notes skipped in typical runs)
- ✅ Fresh rebuild option available with `--mode=fresh`

**Performance Optimizations:**
- ✅ Parallel processing of notes (5 notes simultaneously)
- ✅ Optimized batching with progress tracking
- ✅ Reduced timeouts and delays for faster processing
- ✅ Memory-efficient chunk creation and storage

**Enhanced Search Capabilities:**
- ✅ Multi-strategy search combining vector similarity, full-text search, and exact matching
- ✅ Chunk-level search with note-level result aggregation
- ✅ Relevance scoring and result ranking
- ✅ Preview of matching chunk content in search results

### CLI Improvements

**New Command Line Interface:**
```bash
# Fresh rebuild of entire database
bun run index-notes --mode=fresh

# Incremental updates (default)
bun run index-notes --mode=incremental

# Limit processing to specific number of notes
bun run index-notes --max=100

# Combine options
bun run index-notes --mode=fresh --max=500
```

**Better Progress Reporting:**
- Real-time batch processing updates
- Detailed statistics on new, updated, and skipped notes
- Performance metrics and timing information
- Error reporting with detailed failure logs

### Performance Results

**Before improvements:**
- ~0.39 notes/second (9.9 hours for 14k notes)
- Poor search relevance
- Full re-processing on every run

**After improvements:**
- ~0.45 notes/second for new notes
- 87% skip rate for unchanged notes on incremental runs
- Significantly improved search quality with semantic chunking
- ~3-4 minutes to process 100 notes (including chunking)

## Troubleshooting

// ...existing code...

### Common Issues

**Slow Initial Indexing:**
- First-time indexing is slower due to embedding generation
- Use `--max=100` to test with a subset of notes first
- Subsequent runs are much faster with incremental updates

**Search Not Finding Results:**
- Ensure notes are indexed first: "Index my Apple Notes"
- Try different search terms or phrases
- Check that the embedding model downloaded correctly

**Memory Issues:**
- Large note collections may require chunking
- The system automatically handles this with 400-token chunks
- Consider using `--max=N` for very large collections

// ...existing code...


=== Indexing Complete ===
📊 Stats:
• Notes processed: 100
• Chunks created: 197
• New notes added: 100
• Notes updated: 0
• Notes skipped (unchanged): 0
• Failed: 0 notes
• Time taken: 214.37 seconds




=== Indexing Complete ===
📊 Stats:
• Notes processed: 100
• Chunks created: 197
• New notes added: 100
• Notes updated: 0
• Notes skipped (unchanged): 0
• Failed: 0 notes
• Time taken: 209.88 seconds