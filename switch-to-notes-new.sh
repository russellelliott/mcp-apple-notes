#!/bin/bash

# Script to switch from broken 'notes' table to working 'notes_new' table

DATA_DIR="$HOME/.mcp-apple-notes/data"

echo "🔍 Checking tables in $DATA_DIR"

if [ ! -d "$DATA_DIR" ]; then
    echo "❌ Data directory not found: $DATA_DIR"
    exit 1
fi

cd "$DATA_DIR"

echo ""
echo "📋 Current tables:"
ls -lh *.lance/ 2>/dev/null || echo "No .lance tables found"

echo ""
echo "🔄 Renaming tables..."

# Backup the broken notes table
if [ -d "notes.lance" ]; then
    echo "  📦 Backing up broken 'notes' table to 'notes_broken_backup'"
    mv notes.lance notes_broken_backup.lance
    echo "  ✅ Backup created"
else
    echo "  ℹ️  No existing 'notes' table found"
fi

# Rename notes_new to notes
if [ -d "notes_new.lance" ]; then
    echo "  🔄 Renaming 'notes_new' to 'notes'"
    mv notes_new.lance notes.lance
    echo "  ✅ Renamed successfully"
else
    echo "  ❌ 'notes_new' table not found!"
    exit 1
fi

echo ""
echo "📋 Updated tables:"
ls -lh *.lance/ 2>/dev/null

echo ""
echo "✅ Done! You can now use: bun cli.ts --max=10"
echo "💡 The old broken table is backed up at: notes_broken_backup.lance"
