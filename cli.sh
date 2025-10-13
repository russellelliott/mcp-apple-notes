#!/bin/bash

# Enhanced Apple Notes MCP Server CLI
# 
# This script runs the enhanced indexing method that:
# - Fetches all note titles, creation dates, and modification dates first
# - Then fetches full content by precise title+date matching
# - Supports incremental updates to only process new/modified notes
# - Handles duplicate note titles better than the original method
# - Includes detailed logging showing progress through batches
# - Caches note metadata to enable fast incremental updates
#
# Usage Examples:

# Incremental mode (default) - only process new/modified notes
# bun cli.ts

# Fresh rebuild mode - reindex all notes from scratch
# bun cli.ts --mode=fresh

# Test with limited notes
# bun cli.ts --max=10 --mode=fresh

# Incremental update with limit (for testing)
# bun cli.ts --max=100

bun cli.ts --max=10 --mode=fresh