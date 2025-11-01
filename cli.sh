#!/bin/bash

# Index the Notes
bun cli.ts --max=10 --mode=fresh

# Perform Clustering on the Notes and display them
bun cluster-and-display.ts