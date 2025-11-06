# Clustering Documentation Index

## 📚 Documentation Files

### Getting Started
- **[README-CLUSTERING.md](README-CLUSTERING.md)** - Start here! Complete overview + quick start
- **[QUICK-REFERENCE.md](QUICK-REFERENCE.md)** - One-page cheat sheet for common tasks

### Understanding the System
- **[VISUAL-GUIDE.md](VISUAL-GUIDE.md)** - Illustrated explanations of how semantic quality scoring works
- **[SEMANTIC-QUALITY-GUIDE.md](SEMANTIC-QUALITY-GUIDE.md)** - Technical deep-dive into quality scores and design decisions

### Comparison & History
- **[OLD-VS-NEW.md](OLD-VS-NEW.md)** - Detailed comparison between old (distance-only) and new (semantic quality) approaches
- **[CLUSTERING-GUIDE.md](CLUSTERING-GUIDE.md)** - Original clustering principles (still relevant)

### Implementation Details
- **[IMPLEMENTATION-NOTES.md](IMPLEMENTATION-NOTES.md)** - Technical notes on what was implemented and how

---

## 🎯 Quick Navigation

### I just want to cluster my notes
```bash
bun two-pass-clustering-v2.ts
bun cluster-and-display.ts
```
See: [README-CLUSTERING.md](README-CLUSTERING.md)

### I want to understand how it works
1. Read: [VISUAL-GUIDE.md](VISUAL-GUIDE.md) (illustrated)
2. Read: [SEMANTIC-QUALITY-GUIDE.md](SEMANTIC-QUALITY-GUIDE.md) (technical)

### I'm getting unexpected results
1. Check: [QUICK-REFERENCE.md](QUICK-REFERENCE.md) - troubleshooting section
2. Read: [OLD-VS-NEW.md](OLD-VS-NEW.md) - understand quality vs coverage trade-off

### I'm comparing approaches
See: [OLD-VS-NEW.md](OLD-VS-NEW.md)

### I need technical details
See: [IMPLEMENTATION-NOTES.md](IMPLEMENTATION-NOTES.md)

---

## 📖 Reading Guide by Audience

### For Users (Want to cluster their notes)
1. Start: [README-CLUSTERING.md](README-CLUSTERING.md) - Overview
2. Reference: [QUICK-REFERENCE.md](QUICK-REFERENCE.md) - Commands
3. Understand: [VISUAL-GUIDE.md](VISUAL-GUIDE.md) - How it works

### For Developers (Want to understand the code)
1. Overview: [README-CLUSTERING.md](README-CLUSTERING.md)
2. Design: [IMPLEMENTATION-NOTES.md](IMPLEMENTATION-NOTES.md)
3. Technical: [SEMANTIC-QUALITY-GUIDE.md](SEMANTIC-QUALITY-GUIDE.md)
4. Comparison: [OLD-VS-NEW.md](OLD-VS-NEW.md)

### For Decision Makers (Want pros/cons)
1. Quick: [QUICK-REFERENCE.md](QUICK-REFERENCE.md) - Benefits summary
2. Detailed: [OLD-VS-NEW.md](OLD-VS-NEW.md) - Full comparison
3. Technical: [SEMANTIC-QUALITY-GUIDE.md](SEMANTIC-QUALITY-GUIDE.md)

---

## 🔑 Key Concepts Quick Reference

### Quality Score
- **What**: Measure of semantic fit (0-1)
- **How**: Cosine similarity of embedding vectors
- **Where**: [SEMANTIC-QUALITY-GUIDE.md](SEMANTIC-QUALITY-GUIDE.md), [VISUAL-GUIDE.md](VISUAL-GUIDE.md)

### minClusterSize Parameter
- **What**: Minimum points needed to form a cluster
- **Range**: 1 (permissive) to 15+ (restrictive)
- **Default**: 2 (recommended)
- **Where**: [README-CLUSTERING.md](README-CLUSTERING.md), [QUICK-REFERENCE.md](QUICK-REFERENCE.md)

### Coverage vs Purity Trade-off
- **Coverage**: % of notes assigned to clusters
- **Purity**: Quality of cluster coherence
- **Trade-off**: More coverage = less purity
- **Where**: [OLD-VS-NEW.md](OLD-VS-NEW.md), [SEMANTIC-QUALITY-GUIDE.md](SEMANTIC-QUALITY-GUIDE.md)

### Semantic Quality Threshold (0.65)
- **What**: Minimum quality score to reassign outlier
- **Why**: Empirically optimal for semantic similarity
- **Change**: Edit `index.ts` line ~220 if needed
- **Where**: [SEMANTIC-QUALITY-GUIDE.md](SEMANTIC-QUALITY-GUIDE.md)

---

## 📋 Command Reference

```bash
# Cluster with defaults (recommended)
bun two-pass-clustering-v2.ts

# View results
bun cluster-and-display.ts

# Conservative clustering (fewer clusters, more quality)
bun two-pass-clustering-v2.ts --min-size=5

# Aggressive clustering (more clusters, better coverage)
bun two-pass-clustering-v2.ts --min-size=1

# High-precision clustering (only strong clusters)
bun two-pass-clustering-v2.ts --min-size=10
```

See: [QUICK-REFERENCE.md](QUICK-REFERENCE.md)

---

## 🎓 Learning Path

### Beginner (Just want to use it)
1. [README-CLUSTERING.md](README-CLUSTERING.md) - Overview + quick start
2. Run: `bun two-pass-clustering-v2.ts`
3. View: `bun cluster-and-display.ts`
4. Done! You're clustering.

### Intermediate (Want to understand)
1. [VISUAL-GUIDE.md](VISUAL-GUIDE.md) - See illustrated examples
2. [QUICK-REFERENCE.md](QUICK-REFERENCE.md) - Reference guide
3. [SEMANTIC-QUALITY-GUIDE.md](SEMANTIC-QUALITY-GUIDE.md) - Technical details
4. Try: Different `--min-size` values

### Advanced (Want to optimize/modify)
1. [IMPLEMENTATION-NOTES.md](IMPLEMENTATION-NOTES.md) - Architecture
2. [OLD-VS-NEW.md](OLD-VS-NEW.md) - Design decisions
3. Source: `index.ts` - Read the code
4. Experiment: Modify quality threshold if needed

---

## 🔗 File Map

### Code Files
- `index.ts` - Main implementation (functions: `calculateQualityScore`, `reassignOutliersToNearestCluster`, etc.)
- `two-pass-clustering-v2.ts` - User-facing clustering script
- `cluster-and-display.ts` - View clustering results

### Documentation
- `README-CLUSTERING.md` - Main user guide
- `QUICK-REFERENCE.md` - Command reference
- `SEMANTIC-QUALITY-GUIDE.md` - Technical details
- `VISUAL-GUIDE.md` - Illustrated explanations
- `OLD-VS-NEW.md` - Approach comparison
- `CLUSTERING-GUIDE.md` - Original principles
- `IMPLEMENTATION-NOTES.md` - Implementation details
- `README.md` - This index (you are here)

---

## ❓ FAQ

**Q: Where do I start?**
A: Read [README-CLUSTERING.md](README-CLUSTERING.md), then run `bun two-pass-clustering-v2.ts`

**Q: How do I understand quality scores?**
A: Start with [VISUAL-GUIDE.md](VISUAL-GUIDE.md) for illustrations, then [SEMANTIC-QUALITY-GUIDE.md](SEMANTIC-QUALITY-GUIDE.md) for details

**Q: How do I choose minClusterSize?**
A: See [QUICK-REFERENCE.md](QUICK-REFERENCE.md) - When to Adjust section

**Q: What's the difference from before?**
A: Read [OLD-VS-NEW.md](OLD-VS-NEW.md)

**Q: Why does my cluster have unrelated notes?**
A: That's "pollution" - shouldn't happen with semantic scoring. Check [VISUAL-GUIDE.md](VISUAL-GUIDE.md) for explanation

**Q: Can I have 100% coverage?**
A: Technically yes (increase minClusterSize to 1), but quality drops. See trade-off discussion in [OLD-VS-NEW.md](OLD-VS-NEW.md)

**Q: Do I need to retune when I add notes?**
A: No! Semantic scoring auto-adapts. See [SEMANTIC-QUALITY-GUIDE.md](SEMANTIC-QUALITY-GUIDE.md) - Dynamic Adaptation

---

## 📊 Document Overview

| Document | Length | Audience | Time |
|----------|--------|----------|------|
| README-CLUSTERING.md | 5 min read | Users | 5-10 min |
| QUICK-REFERENCE.md | 2 min read | Quick lookup | 2-3 min |
| VISUAL-GUIDE.md | 10 min read | Visual learners | 10-15 min |
| SEMANTIC-QUALITY-GUIDE.md | 15 min read | Technical users | 15-20 min |
| OLD-VS-NEW.md | 10 min read | Decision makers | 10-15 min |
| IMPLEMENTATION-NOTES.md | 10 min read | Developers | 10-15 min |
| CLUSTERING-GUIDE.md | 10 min read | Reference | 10-15 min |

---

## 🚀 Getting Started (Super Quick)

```bash
# 1. Run clustering
bun two-pass-clustering-v2.ts

# 2. View results
bun cluster-and-display.ts

# 3. If you want to adjust:
# Read QUICK-REFERENCE.md and try:
bun two-pass-clustering-v2.ts --min-size=5
```

That's it! For more details, see the docs above.

---

**Last Updated**: November 5, 2025
**Version**: 2.0 (Semantic Quality Scoring)
