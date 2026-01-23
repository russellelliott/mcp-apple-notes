#!/bin/bash

# Index the Notes
# bun cli.ts --max=200 --mode=fresh
# bun cli.ts --max=200 --mode=fresh


# Might as well sync the cache if needed
bun sync-db-cache.ts
