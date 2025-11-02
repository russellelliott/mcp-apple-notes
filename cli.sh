#!/bin/bash

# Index the Notes
bun cli.ts --max=100 --mode=fresh

# Might as well sync the cache if needed
bun sync-db-cache.ts

# Perform Clustering on the Notes and display them
bun cluster-and-display.ts