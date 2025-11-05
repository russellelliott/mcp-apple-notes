# Two-Pass Clustering: Analysis & Configuration Guide

## Problem Statement

The initial implementation of two-pass clustering was **too aggressive** with outlier reassignment:
- All 160 initial HDBSCAN outliers were reassigned to existing clusters
- Result: 100% coverage but significant "cluster pollution"
- Unrelated notes were forced into clusters simply because they were "nearest"

## Root Cause Analysis

### HDBSCAN's Design
- Very good at finding dense, coherent regions
- Explicitly produces outliers (points that don't form dense neighborhoods)
- With `min_cluster_size=2`, it's permissive and creates many small clusters
- **Trade-off**: More precise clusters but more outliers to handle

### The Outlier Reassignment Problem
The original approach: "Assign every outlier to its nearest cluster centroid"
- ✅ Guarantees 100% classification
- ❌ Forces semantically unrelated notes into clusters
- ❌ Creates "catch-all" clusters polluted with diverse notes

**Example of pollution:**
- Cluster "Cmpm244 Data" (28 notes) contains career/university notes
- But also: restaurant reviews, dishwasher manuals, car mods, philosophical musings
- All were reassigned because they were "closest" to something in the cluster

## The Solution: Distance-Aware Reassignment

### Key Insight
Not all outliers should be assigned. Instead:
1. **Calculate distance** from each outlier to all cluster centroids
2. **Only reassign if distance is below threshold**
3. **Leave distant outliers as true outliers** (cluster -1)

### Configuration Parameters

#### 1. `minClusterSize` (HDBSCAN parameter)
Controls the minimum number of points needed to form a cluster

| Value | Effect | Trade-off |
|-------|--------|-----------|
| 1-2 | Very permissive, many small clusters | More outliers produced |
| 5-10 | Moderate, balanced clusters | Good semantic coherence |
| 15+ | Restrictive, only large themes | More outliers but very clean |

**Recommendation**: Start with 2, increase if you're getting too many outliers or pollution.

#### 2. `distanceThreshold` (reassignment parameter)
Maximum distance an outlier can be from a cluster centroid to be reassigned

| Value | Effect | Trade-off |
|-------|--------|-----------|
| 1.0 | Very strict, only nearby outliers reassigned | Many remain as outliers |
| 1.5-2.0 | Moderate, good balance | Recommended sweet spot |
| 2.5-3.0 | Permissive, most outliers reassigned | Risk of pollution |

**Recommendation**: Start with 1.5-2.0, adjust based on results.

## Recommended Configurations

### Configuration 1: **Balanced (Default)**
```bash
bun two-pass-clustering-v2.ts
# minClusterSize=2, distanceThreshold=2.0
```
- **Goal**: Good balance between coverage and accuracy
- **Expected**: 85-95% coverage with moderate pollution
- **Best for**: General use, exploring data

### Configuration 2: **Accuracy-Focused (Conservative)**
```bash
bun two-pass-clustering-v2.ts --min-size=5 --distance=1.5
```
- **Goal**: Prioritize semantic correctness
- **Expected**: 70-80% coverage, very clean clusters
- **Best for**: When pollution is a major concern
- **Trade-off**: More outliers left unassigned

### Configuration 3: **Coverage-Focused (Aggressive)**
```bash
bun two-pass-clustering-v2.ts --min-size=2 --distance=2.5
```
- **Goal**: Maximize percentage of assigned notes
- **Expected**: 95%+ coverage, moderate pollution
- **Best for**: When you want nearly everything clustered
- **Trade-off**: Some clusters may have mixed topics

### Configuration 4: **High-Precision Topics**
```bash
bun two-pass-clustering-v2.ts --min-size=10 --distance=1.0
```
- **Goal**: Find only the strongest topic clusters
- **Expected**: 50-70% coverage, extremely clean
- **Best for**: Identifying core themes vs. miscellaneous
- **Trade-off**: Many notes remain as outliers

## How to Tune Manually

### If you see cluster pollution:
1. **Try**: Decrease `distanceThreshold` (e.g., 2.0 → 1.5)
   - Makes reassignment stricter
   - Fewer outliers will be reassigned
   
2. **Or**: Increase `minClusterSize` (e.g., 2 → 5)
   - Requires larger, denser clusters
   - Fewer initial outliers to reassign

### If you have too many outliers:
1. **Try**: Increase `distanceThreshold` (e.g., 1.5 → 2.0)
   - Makes reassignment more permissive
   - More outliers will be reassigned
   
2. **Or**: Decrease `minClusterSize` (e.g., 5 → 2)
   - Allows smaller clusters to form initially
   - Potentially more reassignment targets

## Understanding the Output

### Distance Statistics
```
📏 Distance threshold: 2.00
📊 Distance Statistics:
   • Min distance to nearest cluster: 1.23
   • Avg distance to nearest cluster: 2.45
   • Max distance to nearest cluster: 4.67
✅ Reassigned 120 outliers to nearby clusters (within threshold)
📌 Kept as outliers: 40 notes (beyond distance threshold)
```

**Interpretation**:
- Min/Max tell you the range of outlier distances
- If Min > threshold: Some outliers will never be reassigned regardless of threshold
- If Max < threshold: All outliers can be reassigned if threshold is high enough

### Cluster Quality Indicators

**Good signs**:
- ✅ Clusters have coherent, related themes
- ✅ Most notes in a cluster share semantic meaning
- ✅ Cluster labels are descriptive and capture the essence

**Bad signs**:
- ❌ Clusters contain diverse, unrelated topics
- ❌ Cluster labels are vague ("Data," "Things")
- ❌ Notes seem forced into clusters they don't belong

## Theoretical Justification

### Why HDBSCAN for all passes?

1. **Doesn't assume cluster shape**: Unlike K-means (spherical), HDBSCAN finds clusters of any shape
2. **Handles variable density**: Different topics have different "density" patterns
3. **Principled outlier detection**: Uses density to decide what's an outlier, not arbitrary distance
4. **Consistency**: Using the same algorithm throughout maintains methodological coherence

### Why distance threshold matters

- **Without threshold**: Forces all outliers somewhere, breaks semantic integrity
- **With threshold**: Respects the fact that some notes are genuinely isolated
- **Biological analogy**: Like saying "this species doesn't quite fit any existing ecosystem perfectly, and that's OK"

## When to Accept Outliers

Not all notes need to be clustered. Consider leaving notes as outliers if:

1. **They're truly isolated** (far from all clusters)
2. **They cover rare or niche topics** (one-off notes)
3. **They're meta/administrative** (generic notes like "TODO," "Links")
4. **Forcing them in would pollute a cluster**

A 70-80% clustering rate with clean clusters is often better than 95%+ coverage with polluted clusters.

## Next Steps

1. **Run the default configuration**:
   ```bash
   bun two-pass-clustering-v2.ts
   ```

2. **Review the results** and identify clusters that are clean vs. polluted

3. **Adjust parameters** based on the specific issues you see

4. **Iterate** until you find the right balance for your use case

---

## Command Line Examples

```bash
# Default: balanced approach
bun two-pass-clustering-v2.ts

# Conservative: prioritize accuracy
bun two-pass-clustering-v2.ts --min-size=5 --distance=1.5

# Aggressive: maximize coverage
bun two-pass-clustering-v2.ts --min-size=2 --distance=2.5

# Experimental: very high precision
bun two-pass-clustering-v2.ts --min-size=8 --distance=1.2

# Check current results (uses default parameters if already clustered)
bun cluster-and-display.ts
```
