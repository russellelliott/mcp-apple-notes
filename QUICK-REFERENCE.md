# Quick Reference: Semantic Clustering

## One-Liner Summary

Instead of hard-coded distance thresholds, outliers are now evaluated for **semantic fit** using cosine similarity. Notes reassign only if quality score ≥ 0.65 (good semantic alignment). This prevents cluster pollution and adapts automatically to your growing dataset.

## Quick Start

```bash
# Run with defaults (recommended)
bun two-pass-clustering-v2.ts

# Conservative: fewer clusters, less pollution
bun two-pass-clustering-v2.ts --min-size=5

# Aggressive: more clusters, better coverage
bun two-pass-clustering-v2.ts --min-size=1
```

## How It Works (Simple Version)

1. **HDBSCAN Pass 1**: Find dense clusters
2. **Semantic Evaluation**: Check if outliers fit well with clusters (using cosine similarity)
3. **Reassign**: Only move outliers that match semantically (quality ≥ 0.65)
4. **HDBSCAN Pass 2**: Cluster remaining outliers

## Understanding Output

### Quality Score (0-1)
- `0.0` = completely unrelated
- `0.65` = good fit threshold (will reassign)
- `1.0` = perfect match

### Example Output
```
✅ Reassigned 120 outliers (quality score ≥ 0.65)
📌 Rejected 40 outliers (poor semantic fit)

💯 Quality Score Statistics:
   • Min: 0.42, Avg: 0.63, Max: 0.88
```
= Most outliers fit well; 40 stay isolated to prevent pollution.

## When to Adjust minClusterSize

| Problem | Solution |
|---------|----------|
| Too many small clusters | Increase `--min-size` (e.g., 5, 10) |
| Too many outliers | Decrease `--min-size` (e.g., 1, 2) |
| Good balance | Keep default `--min-size=2` |

## Key Benefits

✅ No hard-coded tuning needed
✅ Prevents cluster pollution
✅ Adapts as your dataset grows
✅ Semantic quality (not just spatial proximity)
✅ Stays isolated: truly isolated notes won't pollute clusters

## Common Scenarios

**Scenario**: "Restaurant" note keeps getting into "Career" cluster
**Before**: Forced in if spatially close (pollution!)
**After**: Rejected if quality < 0.65 (stays as outlier - clean!)

**Scenario**: You add 100 new notes
**Before**: Need to retune distance threshold
**After**: Quality scoring auto-adapts (no tuning needed)

## FAQ

**Q: What if I have too many outliers?**
A: Try `--min-size=1` to create more initial clusters, giving outliers more options.

**Q: What if clusters are getting polluted?**
A: This shouldn't happen with semantic scoring. If it does, the quality threshold (0.65) can be tuned in the code.

**Q: How often should I recluster?**
A: Anytime you add significant new notes. The semantic scoring will adapt automatically.

**Q: Can I change the quality threshold?**
A: Yes, edit `index.ts` and look for the line `if (qualityScore >= 0.65)` to adjust.

## Files

- `two-pass-clustering-v2.ts` - Main clustering script
- `SEMANTIC-QUALITY-GUIDE.md` - Full technical details
- `CLUSTERING-GUIDE.md` - General clustering principles

## Running After Changes

```bash
# First time
bun two-pass-clustering-v2.ts

# View results
bun cluster-and-display.ts

# Recluster with different settings
bun two-pass-clustering-v2.ts --min-size=5
```
