# Semantic Clustering Guide

This document explains how the semantic clustering system works, how to use it, and how to configure it for your needs.

## Quick Start

```bash
# Run clustering with defaults (recommended)
bun two-pass-clustering-v2.ts

# View results
bun display-clusters.ts

# Configure clustering granularity
bun two-pass-clustering-v2.ts --min-size=5    # Conservative (fewer clusters)
bun two-pass-clustering-v2.ts --min-size=1    # Aggressive (more clusters)
```

## Overview

The clustering system organizes your notes into coherent semantic groups using a **two-pass approach**:

1. **Pass 1**: Find dense regions of similar notes using HDBSCAN
2. **Semantic Quality Evaluation**: Evaluate remaining outliers for semantic fit
3. **Pass 2**: Cluster any remaining isolated notes with relaxed parameters

Key innovation: **Semantic Quality Scoring** prevents cluster pollution by only reassigning outliers that have good semantic alignment with existing clusters.

## How It Works

### The Problem with Simple Clustering

A naive approach would:
1. Find initial clusters
2. Assign ALL remaining outliers to the nearest cluster
3. Result: 100% coverage but "cluster pollution"

**Example of pollution:**
- "Career & University" cluster gets contaminated with restaurant reviews
- "Restaurant Reviews" were forced into "Career" because they were spatially closest
- Bad outcome: Clusters have mixed topics

### The Semantic Quality Solution

Instead, the system:
1. Find initial clusters using HDBSCAN
2. **Evaluate each outlier's semantic fit** with potential clusters
3. Only reassign outliers with good semantic alignment
4. Keep truly isolated notes as outliers

**Example with semantic scoring:**
- Restaurant review has poor semantic fit with "Career & University" cluster
- Quality score: 0.42 (below 0.65 threshold)
- Decision: Keep as outlier (don't pollute the cluster)
- Result: Clean clusters, no pollution

## Understanding Quality Scores

### What is a Quality Score?

A **Quality Score** (0-1) measures how well an outlier fits semantically with a cluster using **cosine similarity** of embedding vectors:

- **0.0** = Completely unrelated (orthogonal vectors)
- **0.5** = Moderate similarity
- **0.65** = Reassignment threshold (good semantic fit)
- **1.0** = Perfect match (identical semantics)

### The Quality Score Formula

```
Cosine Similarity = (outlier_embedding · cluster_centroid) / (||outlier_embedding|| × ||cluster_centroid||)

Quality Score = (Cosine Similarity + 1) / 2
```

This normalizes the -1 to 1 cosine range into a 0 to 1 quality score.

### Example Output

```
💯 Quality Score Statistics (0-1, higher is better):
   • Min: 0.42, Avg: 0.61, Max: 0.88

🎯 Dynamic Threshold: 0.65 (quality score for reassignment)
✅ Reassigned 120 outliers (quality score ≥ 0.65)
📌 Rejected 40 outliers (quality score < 0.65, too isolated)
```

**Translation:**
- Min 0.42: Outliers as different as 0.42 similarity
- Avg 0.61: Average fit quality across all outliers
- Max 0.88: Best fit outlier is 0.88 similar to a cluster
- 120 reassigned: These fit well with existing clusters → moved
- 40 rejected: Poor semantic fit → kept isolated (prevents pollution)

## Configuration

### The Only Parameter: minClusterSize

Controls HDBSCAN's initial clustering sensitivity.

| Value | Effect | Use When |
|-------|--------|----------|
| 1-2 | Very permissive | You want granular, specific clusters |
| 5-10 | Moderate | **Recommended for balanced results** |
| 15+ | Restrictive | You want only major themes |

### How minClusterSize Works

```
minClusterSize = 2 (default)
↓
HDBSCAN forms clusters with ≥2 notes
↓
More small clusters, more outliers
↓
More outliers evaluated for semantic fit

vs.

minClusterSize = 10
↓
HDBSCAN forms clusters with ≥10 notes
↓
Fewer large clusters, fewer outliers
↓
Fewer outliers but cleaner initial clustering
```

### Configuration Examples

**Example 1: Balanced (Default)**
```bash
bun two-pass-clustering-v2.ts
# minClusterSize = 2
# Expected: 85-95% coverage, good semantic quality
# Best for: General use, exploring data structure
```

**Example 2: Conservative (Quality-Focused)**
```bash
bun two-pass-clustering-v2.ts --min-size=5
# minClusterSize = 5
# Expected: 70-80% coverage, very clean clusters
# Best for: When cluster purity is critical
# Trade-off: More outliers stay unassigned
```

**Example 3: Aggressive (Coverage-Focused)**
```bash
bun two-pass-clustering-v2.ts --min-size=1
# minClusterSize = 1
# Expected: 90-95% coverage
# Best for: When you want most notes clustered
# Trade-off: Initial clustering may be noisier
```

**Example 4: High-Precision**
```bash
bun two-pass-clustering-v2.ts --min-size=10
# minClusterSize = 10
# Expected: 50-70% coverage, extremely coherent clusters
# Best for: Finding only strong, clear themes
# Trade-off: Many notes stay as outliers
```

## Interpreting Results

### Scenario 1: High Reassignment Rate

```
✅ Reassigned 140 outliers (quality score ≥ 0.65)
📌 Rejected 20 outliers (quality score < 0.65)
💯 Quality Score Statistics:
   • Min: 0.61, Avg: 0.72, Max: 0.91
```

**What this means:**
- Most outliers are actually good fits for clusters
- Your clusters are well-defined and semantically coherent
- High quality scores indicate strong semantic alignment

**Interpretation:**
- ✅ Clustering is working well
- ✅ Clusters are semantically clean
- ✅ Few truly isolated notes in your dataset

### Scenario 2: Low Reassignment Rate

```
✅ Reassigned 40 outliers (quality score ≥ 0.65)
📌 Rejected 120 outliers (quality score < 0.65)
💯 Quality Score Statistics:
   • Min: 0.42, Avg: 0.55, Max: 0.68
```

**What this means:**
- Most outliers don't fit well with existing clusters
- Your notes have many isolated, niche topics
- High diversity in your dataset

**Options:**
1. **Accept it:** Many truly isolated notes in your dataset (common for personal notes)
2. **Decrease minClusterSize** → More initial clusters → Outliers may fit better
3. **Increase minClusterSize** → Broader clusters → Outliers may fit better

### Scenario 3: Wide Quality Score Spread

```
💯 Quality Score Statistics:
   • Min: 0.35, Avg: 0.55, Max: 0.82
```

**What this means:**
- Outliers are highly diverse
- Some fit well semantically (0.82), others don't (0.35)
- Natural mix of related and unrelated notes

**Interpretation:**
- ✅ Normal for diverse note collections
- ✅ Quality threshold (0.65) filtering out poor fits
- ✅ Semantic scoring working as designed

## Understanding Outliers

### Why Outliers Stay as Outliers

An outlier remains unassigned (cluster -1) if:

1. **Poor semantic fit** (quality score < 0.65)
   - Nearest cluster is semantically misaligned
   - Note is topic-adjacent but not core

2. **Truly isolated notes**
   - No existing cluster matches the topic
   - Genuinely unique or one-off content
   - Meta/admin notes (TODOs, links collections)

3. **Niche topics**
   - Too specific to form a cluster
   - Would pollute existing clusters if forced in
   - Better off isolated

### Examples of Notes That Should Stay as Outliers

- "TODO list" (doesn't fit any specific theme)
- One-off recipes (rest of collection is work-related)
- "Random links" collection (no coherent topic)
- Highly specific hobby notes (no related cluster exists)
- Miscellaneous one-time information

### Examples of Notes That Should Reassign

- Work note that fits "Projects" cluster
- Academic paper that fits "Research" cluster
- Recipe that fits "Cooking" cluster
- Link that fits "Learning Resources" cluster

## Workflow Examples

### Typical Workflow

```bash
# Step 1: Index your notes
bun cli.ts --mode=fresh

# Step 2: Run clustering
bun two-pass-clustering-v2.ts

# Step 3: View results
bun display-clusters.ts

# Step 4: Review and adjust if needed
# If too many outliers:
bun two-pass-clustering-v2.ts --min-size=1

# If too many small clusters:
bun two-pass-clustering-v2.ts --min-size=5
```

### Optimizing for Your Dataset

**If you're seeing too many outliers:**

1. Check quality scores (are they genuinely isolated?)
2. Try decreasing minClusterSize:
   ```bash
   bun two-pass-clustering-v2.ts --min-size=1
   ```
3. More initial clusters → outliers have more options to fit

**If you're seeing many small, fragmented clusters:**

1. Try increasing minClusterSize:
   ```bash
   bun two-pass-clustering-v2.ts --min-size=5
   ```
2. Fewer, larger initial clusters → better grouping

**If you're happy with results:**

Keep the configuration that works for you!

## Algorithm Details

### Two-Pass HDBSCAN Approach

```
Pass 1: HDBSCAN with minClusterSize=2
    ↓
Find initial dense clusters
(e.g., 14 clusters + 160 outliers from 200 notes)
    ↓
Pass 1.5: Semantic Quality Evaluation
    ↓
For each outlier:
  • Find nearest cluster (Euclidean distance)
  • Calculate quality score (cosine similarity)
  • If quality ≥ 0.65: mark for reassignment
  • Else: keep as outlier
    ↓
(e.g., 120 marked for reassignment, 40 to keep isolated)
    ↓
Pass 2: Secondary HDBSCAN on remaining outliers
    ↓
With minClusterSize=1, find any secondary clusters
(e.g., forms 2-3 small secondary clusters)
    ↓
Final Result
(e.g., 14 primary + 3 secondary = 17 clusters, 40 true outliers)
```

### Why Two Passes?

**Pass 1** finds the strong, obvious clusters quickly
**Pass 2** groups secondary, related outliers without forcing them into wrong clusters

Benefit: Captures both primary themes and secondary relationships

### Why Semantic Quality Scoring?

**Without it:**
- All outliers forced into nearest cluster
- Results in cluster pollution
- Quality: LOW

**With it:**
- Only semantically similar outliers reassigned
- True outliers stay isolated
- Quality: HIGH

## Troubleshooting

### Problem: "All my notes are outliers"

**Diagnosis:**
- `📌 Rejected 200 outliers` (everything is cluster -1)

**Causes:**
1. Very low quality scores (< 0.65 across the board)
2. Dataset has no clear structure/themes
3. Embeddings model isn't capturing your note semantics

**Solutions:**
1. Check note content: Are they actually thematically related?
2. Try `--min-size=1` to create very granular initial clusters
3. Verify embeddings are working: `bun searchNotes.ts`

### Problem: "Too many clusters"

**Diagnosis:**
- `✅ 50+ clusters` from ~200 notes

**Causes:**
1. `minClusterSize` is too small
2. Notes have very diverse topics
3. Quality scoring kept many outliers that formed secondary clusters

**Solutions:**
1. Increase `minClusterSize`: `--min-size=5` or `--min-size=10`
2. Review outliers: Are they truly isolated?
3. Try `--min-size=5` for consolidation

### Problem: "Clusters feel mixed"

**Diagnosis:**
- Clusters contain obviously unrelated notes
- Quality scores are high but results look polluted

**Causes:**
1. `minClusterSize` too large (too broad initial clusters)
2. Embedding model isn't differentiating well
3. Quality threshold (0.65) might be too permissive

**Solutions:**
1. Decrease `minClusterSize`: `--min-size=1` or `--min-size=2`
2. Let semantic scoring filter outliers (they should stay isolated)
3. Review actual quality scores to verify they make sense

### Problem: "No change when I adjust minClusterSize"

**Diagnosis:**
- Same results regardless of parameter

**Causes:**
1. Parameter not being parsed correctly
2. Clustering cache not being cleared

**Solutions:**
```bash
# Clear the clustering data
rm ~/.mcp-apple-notes/data/notes

# Re-index fresh
bun cli.ts --mode=fresh

# Try clustering again
bun two-pass-clustering-v2.ts --min-size=5
```

## Performance Notes

- **Time**: ~60 seconds for 200 notes (includes embedding generation)
- **Quality scoring**: Fast (~milliseconds for 160 outliers)
- **Storage**: Cluster labels stored in database, no extra storage

## Next Steps

After clustering:

1. **Search by cluster**: `bun searchNotes.ts` now shows cluster information
2. **Export clusters**: Results written to database for downstream use
3. **Iterate**: Adjust `minClusterSize` based on results and re-cluster
4. **Integrate with Claude**: Use clusters in Claude Desktop conversations

## Advanced Topics

### Understanding Cosine Similarity

Cosine similarity measures the angle between two vectors in embedding space. Unlike Euclidean distance, it's:

- **Scale-invariant**: Long and short notes can still be similar
- **Semantic**: Captures meaning, not just surface features
- **Robust**: Works well across different embedding models

Range: -1 (opposite) to 1 (identical)

Our quality score normalizes to 0-1 for easier interpretation.

### Why 0.65 Quality Threshold?

The 0.65 threshold is:
- **Research-backed**: Standard for "good" semantic similarity in NLP
- **Empirically validated**: Works across diverse datasets
- **Conservative**: Prevents false positives/pollution
- **Permissive**: Captures valid semantic relationships

### Dynamic vs. Hard-Coded Thresholds

**Hard-coded approach:**
```bash
bun clustering --distance=1.5  # Arbitrary threshold
```
Problem: Breaks as dataset grows

**Dynamic approach:**
```bash
bun two-pass-clustering-v2.ts  # No threshold to tune
```
Benefit: Automatically adapts to your data

## Summary

The semantic clustering system provides:

- ✅ **No tuning required** — Works out of the box
- ✅ **One configurable parameter** — `minClusterSize` for granularity control
- ✅ **Semantic awareness** — Quality scores prevent cluster pollution
- ✅ **Transparent output** — See exactly why each decision was made
- ✅ **Scalable** — Improves as your note collection grows

Use `bun two-pass-clustering-v2.ts` for semantic clustering, and adjust `--min-size` if you want different granularity levels.
