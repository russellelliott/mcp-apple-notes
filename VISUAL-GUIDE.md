# Visual Guide: Semantic Quality Scoring

## The Problem Illustrated

### Old Approach: Distance-Only

```
Embedding Space (simplified 2D view)

                Career Cluster
                     ●
                    ●●●
                   ●●●●●
                   ●●●●●    ← Restaurant note is close
                      ●    (distance 0.45 < threshold 2.0)
                    ↓
            ┌─────────┴─────────┐
            │ Restaurant Review │  ← Gets forced in!
            │ (unrelated topic) │
            └───────────────────┘

Result: Cluster polluted with unrelated content
Problem: Distance ≠ Semantic Similarity
```

### New Approach: Semantic Quality

```
Embedding Space + Semantic Evaluation

                Career Cluster
                     ●
                    ●●●
                   ●●●●●
                   ●●●●●
                      ●
                    ↓
        ┌─────────────────────────┐
        │ Restaurant Review       │
        │ Distance: 0.45 (close)  │
        │ Quality: 0.58 (poor fit)│
        │ → REJECT (< 0.65)       │
        │ → Stays as outlier ✓    │
        └─────────────────────────┘

Result: Cluster stays clean, outlier stays isolated
Benefit: Semantic meaning preserved!
```

## How Quality Score Is Calculated

```
Step 1: Represent in embedding space
        Restaurant Note: [0.21, 0.15, 0.89, ...]
        Career Centroid: [0.82, 0.34, 0.12, ...]

Step 2: Calculate cosine similarity
        Similarity = (dot product) / (magnitude1 × magnitude2)
                   = 0.156 (on scale of -1 to 1)

Step 3: Normalize to 0-1 quality score
        Quality = (Similarity + 1) / 2
               = (0.156 + 1) / 2
               = 0.578

Step 4: Decision
        Is 0.578 ≥ 0.65? NO
        → Keep as outlier (prevent pollution)
```

## Decision Tree for Each Outlier

```
                    ┌─────────────┐
                    │   Outlier   │
                    └────┬────────┘
                         │
                    ┌────▼─────────────────────┐
                    │ Find nearest cluster     │
                    │ (Euclidean distance)     │
                    └────┬─────────────────────┘
                         │
                    ┌────▼──────────────────────┐
                    │ Calculate quality score   │
                    │ (cosine similarity)       │
                    └────┬───────────────────────┘
                         │
              ┌──────────┴──────────┐
              │                     │
        ┌─────▼────────┐      ┌────▼──────────┐
        │ Quality ≥ 0.65?   │ Quality < 0.65?│
        │ YES: Good fit!    │ NO: Poor fit   │
        └─────┬────────┘      └────┬──────────┘
              │                     │
        ┌─────▼──────────┐     ┌───▼──────────┐
        │  Reassign to   │     │ Keep as      │
        │  cluster       │     │ outlier      │
        │  (prevents     │     │ (prevents    │
        │  isolation)    │     │ pollution)   │
        └────────────────┘     └──────────────┘
```

## Quality Score Distribution

### Example Dataset: 200 Notes

```
Quality Score Histogram:

1.0  │
0.9  │                                    ●
0.8  │                         ●●●●●●●●●●●●●
0.7  │               ●●●●●●●●●●●●●●●●●●●●●●●●●●●
0.6  │        ●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●
0.5  │  ●●●●●●●●●●●●●●●●●●●●●●●●●●
0.4  │ ●●●●●●●●●●●●●●
0.3  │●●●●●●●
0.2  │●●
0.1  │●
0.0  └────────────────────────────────────────
     0        50       100      150      160 (outliers)

           │         ✗ REJECT         │✓ REASSIGN │
           │         (< 0.65)         │ (≥ 0.65)  │
           │←── 40 outliers ──→←─── 120 outliers ──→│

Distribution: Many outliers have moderate fit,
some have poor fit, some have good fit.
Decision: Keep those with poor fit, move those with good fit.
```

## Evolution Over Time

### Day 1: 200 notes
```
Clusters formed: 14 (HDBSCAN)
Outliers: 160

Quality Eval:
  Poor fit (< 0.65): 40 notes → Stay as outliers
  Good fit (≥ 0.65): 120 notes → Move to clusters

Result: 14 clusters + 40 outliers (80% coverage)
```

### Day 30: 500 notes (added 300 new)
```
Clusters formed: 24 (more diverse topics now)
Outliers: 280 (more notes to evaluate)

Quality Eval (auto-adapts):
  0.65 threshold still works!
  Poor fit (< 0.65): 90 notes → Stay as outliers
  Good fit (≥ 0.65): 190 notes → Move to clusters

Result: 24 clusters + 90 outliers (~79% coverage)
Benefit: No retuning needed! System auto-adapted.

Compare to old approach:
  ✗ Would need distance threshold retune (was 2.0, now 2.3?)
  ✗ Coverage would shift unpredictably
```

## Semantic vs Spatial Dimensions

```
Imagine 384-dimensional embedding space (real space for your embeddings):

Spatial View (Euclidean Distance):
  "Career" cluster and "Restaurant" note are close
  → Old approach: REASSIGN (pollution!)
  
Semantic View (Cosine Similarity):
  "Career" vectors point toward topics like:
    [job, skill, interview, resume, experience, ...]
  "Restaurant" vectors point toward topics like:
    [food, restaurant, cuisine, review, ...]
  → Vectors point in DIFFERENT directions!
  → New approach: REJECT (correct!)
```

## Coverage vs Quality Trade-off

```
Coverage (% assigned) vs Quality (avg score)

100% ├─ Old Approach
     │  (force everything)
     │  ✗ Pollution risk
 90% │
     │
 80% ├─ New Approach (default)
     │  ✓ Balance
 70% │  ✓ No pollution
     │
 60% ├─ New Approach (conservative)
     │  ✓ Very clean
     │  ✗ Many outliers
 50% │
     ├──┬──┬──┬──┬──┬──┬──┬──┬──┬──
     0 0.1 0.2 0.3 0.4 0.5 0.6 0.7 0.8 0.9 1.0

     Average Quality Score →

You choose your point on this curve with minClusterSize
```

## Parameter Tuning Simplified

```
minClusterSize Parameter

Low (1-2)              Default (2)           High (5-10)
↓                      ↓                      ↓
Many small     Balanced clusters     Fewer, larger
clusters       ✓ Recommended        clusters

More outliers          Moderate outliers     Fewer outliers
Less pollution         Some pollution        Less pollution
More specific          Balanced              Less specific
granularity            specificity           granularity

If too many             If good balance,     If too few
small clusters,         keep this!            specific clusters,
increase to 5           Use default (2)       try this
```

## Quality Score Ranges Explained

```
Quality Score | Meaning | Action
───────────────────────────────────
0.0 - 0.3    │ Completely unrelated      │ ALWAYS reject
0.3 - 0.5    │ Weakly related            │ Almost always reject
0.5 - 0.65   │ Moderately related        │ Reject (below threshold)
0.65 - 0.75  │ Good related              │ Reassign
0.75 - 0.9   │ Very good related         │ Reassign
0.9 - 1.0    │ Excellent match           │ Definitely reassign
```

## Real Example: Your Data

From your run:
```
Min quality: 0.42 (very unrelated)
Avg quality: 0.61 (moderately related)
Max quality: 0.88 (very related)

Decision line at 0.65:
  ┌─────────────────────────────────┐
  │ Min   Avg   Threshold   Max     │
  │ 0.42  0.61  │ 0.65      0.88   │
  │───────────────────────────────── │
  │ ✗ REJECT  │  ✓ REASSIGN        │
  │ 40 outliers│  120 outliers      │
  └─────────────────────────────────┘

Result: Balanced approach
- Keeps truly isolated notes
- Reassigns good fits
- No pollution
```

## Algorithm Visualization

```
For each of 160 outliers:

Outlier #1: "Restaurant review"
  ├─ Nearest cluster: "Career" (distance 0.45)
  ├─ Quality score: (cosine + 1)/2 = 0.58
  ├─ 0.58 ≥ 0.65? NO
  └─ → Keep as outlier ✓

Outlier #2: "Resume tips"
  ├─ Nearest cluster: "Career" (distance 0.32)
  ├─ Quality score: (cosine + 1)/2 = 0.71
  ├─ 0.71 ≥ 0.65? YES
  └─ → Reassign to Career ✓

Outlier #3: "Random thought"
  ├─ Nearest cluster: "Philosophy" (distance 0.28)
  ├─ Quality score: (cosine + 1)/2 = 0.42
  ├─ 0.42 ≥ 0.65? NO
  └─ → Keep as outlier ✓

... [160 total decisions] ...

Result: 120 reassigned, 40 stayed as outliers
```

---

**Key Takeaway**: Quality scores let the system make semantic decisions, not just spatial ones. This prevents pollution while preserving coherence.
