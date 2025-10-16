# Apple Notes MCP Server - Usage Guide

This project provides semantic search and clustering functionality for Apple Notes using vector embeddings and LanceDB.

## Quick Start

### 1. Index Your Notes
First, process your Apple Notes into the vector database:

```bash
# Index all notes (fresh rebuild)
bun cli.ts --max=100 --mode=fresh

# Index up to 50 notes
bun cli.ts --max=50 --mode=fresh

# Incremental indexing (only new/changed notes)
bun cli.ts --max=100 --mode=incremental
```

### 2. Cluster and Display Results
After indexing, run clustering to group similar notes:

```bash
# Run clustering and display all clusters
bun cluster-and-display.ts
```

### 3. Search Your Notes
Search through your indexed notes semantically:

```bash
# Interactive search
bun searchNotes.ts
```

## File Overview

### Main Scripts

- **`cli.ts`** - Main indexing script that processes Apple Notes into vector database
- **`cluster-and-display.ts`** - Clusters notes by similarity and displays all clusters
- **`searchNotes.ts`** - Interactive semantic search through your notes

### Debugging/Inspection Scripts

- **`inspect-db.ts`** - Shows database contents and sample records
- **`sync-db-cache.ts`** - Synchronizes cache with database and shows statistics

### Core Library

- **`index.ts`** - Core functionality (database operations, clustering, embeddings)

## Typical Workflow

1. **Fresh Start**: `bun cli.ts --max=100 --mode=fresh`
2. **View Clusters**: `bun cluster-and-display.ts`
3. **Search Notes**: `bun searchNotes.ts`

## Configuration

- **Database**: Stored in `~/.mcp-apple-notes/data`
- **Cache**: Stored in `~/.mcp-apple-notes/notes-cache.json`
- **Embeddings**: Uses HuggingFace BGE-small-en-v1.5 model
- **Clustering**: DBSCAN algorithm with epsilon=0.6, min_samples=2

## Clustering Results

The clustering algorithm groups semantically similar notes together. Results include:

- **Meaningful Clusters**: Groups of 2+ related notes
- **Outliers**: Individual notes that don't fit into clusters
- **Cluster Labels**: Auto-generated based on common themes

## Notes

- Use `--mode=fresh` for complete rebuilds
- Use `--mode=incremental` for daily updates
- The system handles duplicate note titles by using creation dates
- Clustering works best with diverse note content