# Apple Notes MCP Server - Usage Guide

This project provides semantic search and clustering functionality for Apple Notes using vector embeddings and LanceDB.

## Quick Start

### 1. Index Your Notes
First, process your Apple Notes into the vector database:

# Usage — Quick run order

A minimal guide showing the order to run the main scripts. Indexing (writing the DB and cache) is required first.

1) Install dependencies (one-time)

```bash
bun install
```

2) Index your Apple Notes (required)

```bash
# Full rebuild (drops and recreates the notes table)
bun cli.ts --mode=fresh --max=1000

# Incremental (day-to-day, only new/changed notes)
bun cli.ts --mode=incremental --max=200
```

Note: the indexer (cli.ts → `fetchAndIndexAllNotes`) writes both the LanceDB `notes` table and the on-disk cache (`~/.mcp-apple-notes/notes-cache.json`).

3) (Optional) Inspect / sync diagnostics

```bash
# Inspect database and check for cache/database divergence
bun sync-db-cache.ts
```

Run this only if you suspect the cache and DB are out of sync (manual DB edits, restore from backup). The canonical writer of cache and DB is the indexer.

4) Apply clustering (optional) and display results

```bash
# Run clustering and print clusters (writes cluster fields into DB)
bun cluster-and-display.ts

# Or just display existing clusters without re-clustering
bun display-clusters.ts
```

5) Interactive semantic search

```bash
bun searchNotes.ts
```

Minimal notes
- Index first. Everything else reads the LanceDB `notes` table.
- Run `sync-db-cache.ts` only when diagnosing cache/DB divergence — it does not overwrite the cache from the DB.
- Use `--mode=fresh` for full rebuilds and `--mode=incremental` for routine updates.

Paths
- Database: `~/.mcp-apple-notes/data`
- Cache: `~/.mcp-apple-notes/notes-cache.json`

That's it — these steps give a compact, repeatable ordering for the main workflows.