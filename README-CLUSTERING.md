# Semantic Quality Scoring: Complete Implementation Guide

## What Changed

You now have a **dynamic semantic quality-based outlier reassignment system** that:
- ✅ Prevents cluster pollution
- ✅ Uses **dynamic thresholds based on average quality score** (no hard-coding)
- ✅ Automatically scales with your dataset
- ✅ Keeps outliers that don't fit semantically (below-average quality)
- ✅ Adapts as dataset grows - no retuning needed

## Key Concepts

### Quality Score (0-1)
Measures how well an outlier semantically fits with a cluster.
- Calculated using **cosine similarity** of embedding vectors
- **Dynamic threshold**: Uses the AVERAGE quality score from outlier evaluations
- **> average**: Good fit, will be reassigned to cluster
- **≤ average**: Poor fit, stays as outlier (prevents pollution)

### Why Dynamic Threshold?
**Problem with hard-coded 0.65**: 
- Your outliers had min quality of 0.748
- All were ≥ 0.65, so all were reassigned
- Result: Cluster pollution (same as old approach)

**Solution - Dynamic Threshold**:
- Calculate average quality score across all outliers
- Reassign only those ABOVE average
- Keep BELOW average (truly isolated)
- Auto-adapts to any dataset

## Quick Start

```bash
# Run with defaults (now using dynamic threshold)
bun two-pass-clustering-v2.ts

# View results
bun cluster-and-display.ts

# Adjust clustering (if needed)
bun two-pass-clustering-v2.ts --min-size=5  # More conservative
bun two-pass-clustering-v2.ts --min-size=1  # More granular
```

## Understanding Quality Scores

Output example:
```
💯 Quality Score Statistics (0-1, higher is better):
   • Min: 0.42, Avg: 0.61, Max: 0.88

🎯 Dynamic Threshold: 0.61 (average quality score)
✅ Reassigned 80 outliers (quality score > 0.61)
📌 Rejected 80 outliers (quality score ≤ 0.61)
```

**Translation**:
- Min 0.42: Some outliers are very different from all clusters
- Avg 0.61: **This becomes the reassignment threshold**
- Max 0.88: Some outliers are very similar to nearest cluster
- 80 reassigned: Above-average fits → moved to clusters
- 80 rejected: Below-average fits → stay isolated (prevents pollution)

## How It Works

```
1. HDBSCAN Pass 1: Find dense regions
   → Creates initial clusters + outliers

2. Semantic Evaluation:
   a) Calculate quality score for each outlier
   b) Calculate AVERAGE quality score across all outliers
   c) For each outlier:
      - If quality > average: move to cluster
      - If quality ≤ average: keep as outlier

3. HDBSCAN Pass 2: Cluster remaining outliers
   → Creates secondary clusters from isolated notes

4. Persist to database
```

## How to Tune

The **only parameter** is `minClusterSize`:

```bash
# Fewer, larger initial clusters
bun two-pass-clustering-v2.ts --min-size=5

# More, smaller initial clusters
bun two-pass-clustering-v2.ts --min-size=1

# Default: balanced
bun two-pass-clustering-v2.ts
```

### When to adjust:

| Problem | Solution |
|---------|----------|
| Too many small, similar clusters | Increase `--min-size` to 5-10 |
| Not enough granularity | Decrease `--min-size` to 1 |
| Too many outliers | Decrease `--min-size` |
| Still getting cluster pollution | Increase `--min-size` |

## Example Results

**With Dynamic Threshold (0.852 average)**:
```
✅ Reassigned 120 outliers (quality > 0.852)
📌 Rejected 40 outliers (quality ≤ 0.852)

Result: Clean clusters + genuinely isolated outliers
```

**Why this is better**:
- Only high-quality fits are reassigned
- Low-quality fits stay as outliers (no pollution)
- Threshold automatically adapts to your data
- No manual tuning of threshold needed

## Files to Know

| File | Purpose |
|------|---------|
| `two-pass-clustering-v2.ts` | Main script (uses dynamic threshold) |
| `QUICK-REFERENCE.md` | One-page quick guide |
| `SEMANTIC-QUALITY-GUIDE.md` | Technical details |
| `OLD-VS-NEW.md` | Comparison with old approach |
| `VISUAL-GUIDE.md` | Illustrated explanations |

## Common Questions

**Q: What if I have zero outliers (100% assigned)?**
A: That means all outliers have above-average quality scores. Fine! But watch for pollution.

**Q: What if I have lots of outliers?**
A: That means many outliers are below-average quality. Good! Prevents pollution.

**Q: Do I need to retune as I add notes?**
A: No! The dynamic threshold auto-adapts. The average quality score will shift, but the logic stays the same.

**Q: Why "average"?**
A: Average splits the quality scores into above/below, creating a natural cutoff that adapts to your data. No arbitrary thresholds needed.

## Next Steps

1. **Run clustering**:
   ```bash
   bun two-pass-clustering-v2.ts
   ```

2. **Review output**: Look at quality score statistics and reassignment counts

3. **Check clusters**:
   ```bash
   bun cluster-and-display.ts
   ```

4. **Verify quality**: Do clusters make semantic sense? Are outliers truly isolated?

5. **Adjust if needed**: Try `--min-size=5` or `--min-size=1`

6. **Repeat** until satisfied

## Summary

You now have a sophisticated clustering system that:
- Uses **data-driven dynamic thresholds** (no hard-coding)
- Automatically filters outliers by **average quality**
- Prevents cluster pollution
- Scales with your growing dataset
- Needs **minimal tuning**

The dynamic average quality threshold does the heavy lifting. Enjoy clean, coherent clusters!

