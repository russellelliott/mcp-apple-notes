#!/usr/bin/env bun
import { clusterNotes, listClusters, getNotesInCluster } from "./index.js";
import * as lancedb from "@lancedb/lancedb";

/**
 * Configurable Two-Pass Clustering with Dynamic Semantic Quality Scoring
 * 
 * This version uses data-driven, dynamic outlier reassignment:
 * - Automatically evaluates each outlier's semantic fit with clusters
 * - Uses cosine similarity to determine quality of reassignment (0-1 scale)
 * - Dynamic threshold: Uses AVERAGE quality score from evaluation pass
 * - Only reassigns outliers with quality score > average
 * - Truly isolated outliers (below-average quality) stay as outliers
 * - No hard-coded thresholds - adapts to your data
 * 
 * The quality score evaluates semantic alignment, so notes that don't
 * fit well semantically won't pollute clusters even if they're spatially close.
 * 
 * Why the dynamic threshold?
 * - Previous hard-coded threshold (0.65) allowed all outliers through (all ≥ 0.748)
 * - Dynamic threshold (average) automatically filters out low-quality fits
 * - As your dataset grows, threshold auto-adapts
 * 
 * Usage:
 *   bun two-pass-clustering-v2.ts                 # Default
 *   bun two-pass-clustering-v2.ts --min-size=5    # More robust initial clusters
 *   bun two-pass-clustering-v2.ts --min-size=10   # Very conservative clustering
 * 
 * Recommended Configurations:
 * - Default (minClusterSize=2): Balanced, good semantic quality
 * - Conservative (minClusterSize=5): Fewer initial clusters, less pollution
 * - High-precision (minClusterSize=10): Only strong clusters, more outliers
 */

async function twoPassClusteringV2() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let minClusterSize = 2;
  
  for (const arg of args) {
    if (arg.startsWith('--min-size=')) {
      minClusterSize = parseInt(arg.split('=')[1]);
    }
  }
  
  console.log("🎯 Two-Pass Clustering with Semantic Quality Scoring\n");
  console.log("Configuration:");
  console.log(`  • minClusterSize: ${minClusterSize} (HDBSCAN min points per cluster)`);
  console.log(`  • Outlier Evaluation: Semantic quality score (0-1 scale)`);
  console.log(`  • Reassignment Threshold: Quality score ≥ 0.65\n`);
  
  console.log("Pass 1: Initial HDBSCAN clustering");
  console.log("Pass 1.5: Semantic quality evaluation (only reassign high-quality fits)");
  console.log("Pass 2: Secondary HDBSCAN on remaining isolated notes\n");
  
  try {
    const db = await lancedb.connect(`${process.env.HOME}/.mcp-apple-notes/data`);
    const notesTable = await db.openTable("notes");
    
    const allChunks = await notesTable.search("").limit(100000).toArray();
    const uniqueNotes = new Set(allChunks.map(chunk => `${chunk.title}|||${chunk.creation_date}`));
    
    console.log(`📊 Database: ${uniqueNotes.size} notes (${allChunks.length} chunks)\n`);
    
    // ===== RUN CLUSTERING WITH SEMANTIC QUALITY SCORING =====
    console.log("════════════════════════════════════════");
    console.log("🚀 Starting Semantic-Aware Two-Pass Clustering");
    console.log("════════════════════════════════════════\n");
    
    const clusterResult = await clusterNotes(notesTable, minClusterSize, true);
    
    console.log(`\n✅ Clustering Results:`);
    console.log(`   • Primary clusters: ${clusterResult.totalClusters}`);
    console.log(`   • Total notes: ${clusterResult.totalNotes}`);
    console.log(`   • Notes clustered: ${clusterResult.totalNotes - clusterResult.outliers} (${(((clusterResult.totalNotes - clusterResult.outliers) / clusterResult.totalNotes) * 100).toFixed(1)}%)`);
    console.log(`   • Remaining outliers: ${clusterResult.outliers} (${((clusterResult.outliers / clusterResult.totalNotes) * 100).toFixed(1)}%)`);
    console.log(`   • Time: ${clusterResult.timeSeconds.toFixed(1)}s\n`);
    
    // ===== CLUSTER SIZE DISTRIBUTION =====
    if (clusterResult.clusterSizes.length > 0) {
      console.log("📊 Cluster Size Distribution:");
      clusterResult.clusterSizes.slice(0, 10).forEach((cluster, idx) => {
        const barLength = Math.ceil(cluster.size / 2);
        const bar = "█".repeat(barLength);
        console.log(`   ${String(idx + 1).padStart(2)}. ${cluster.label.padEnd(25)} │ ${bar} ${cluster.size} notes`);
      });
      if (clusterResult.clusterSizes.length > 10) {
        console.log(`   ... and ${clusterResult.clusterSizes.length - 10} more clusters`);
      }
      console.log();
    }
    
    // ===== UNIFIED DISPLAY =====
    console.log("════════════════════════════════════════");
    console.log("📊 FINAL CLUSTER COMPOSITION");
    console.log("════════════════════════════════════════\n");
    
    const finalClusters = await listClusters(notesTable);
    const finalRealClusters = finalClusters.filter(c => c.cluster_id !== '-1');
    
    console.log("🎯 ALL CLUSTERS:\n");
    let totalClustered = 0;
    
    for (let i = 0; i < finalRealClusters.length; i++) {
      const cluster = finalRealClusters[i];
      const notesInCluster = await getNotesInCluster(notesTable, cluster.cluster_id);
      totalClustered += notesInCluster.length;
      
      console.log(`📌 Cluster ${i + 1}: "${cluster.cluster_label}"`);
      console.log(`   📊 ${notesInCluster.length} notes`);
      console.log(`   💭 ${cluster.cluster_summary}`);
      console.log(`   📖 Notes:`);
      notesInCluster.forEach((note, idx) => {
        console.log(`      ${idx + 1}. "${note.title}"`);
      });
      console.log();
    }
    
    // Display remaining outliers
    const outlierCluster = await getNotesInCluster(notesTable, '-1');
    if (outlierCluster.length > 0) {
      console.log(`📌 OUTLIERS (${outlierCluster.length} notes):`);
      console.log(`   Notes with poor semantic fit to any cluster:`);
      outlierCluster.forEach((note, idx) => {
        console.log(`      ${idx + 1}. "${note.title}"`);
      });
      console.log();
    }
    
    // ===== FINAL SUMMARY =====
    console.log("════════════════════════════════════════");
    console.log("📈 FINAL SUMMARY");
    console.log("════════════════════════════════════════\n");
    
    console.log(`Configuration Used:`);
    console.log(`  • minClusterSize: ${minClusterSize}\n`);
    
    console.log(`Results:`);
    console.log(`  • Total notes: ${clusterResult.totalNotes}`);
    console.log(`  • Total clusters: ${finalRealClusters.length}`);
    console.log(`  • Notes in clusters: ${totalClustered} (${((totalClustered / clusterResult.totalNotes) * 100).toFixed(1)}%)`);
    console.log(`  • Remaining outliers: ${outlierCluster.length} (${((outlierCluster.length / clusterResult.totalNotes) * 100).toFixed(1)}%)`);
    console.log(`  • Processing time: ${clusterResult.timeSeconds.toFixed(1)}s`);
    
    console.log(`\n✨ Semantic-aware clustering complete!`);
    console.log(`   💾 All changes persisted to database`);
    console.log(`   � Using quality scores (0-1) for semantic evaluation`);
    console.log(`   🎯 Only high-quality reassignments (score ≥ 0.65)`);
    console.log(`   🔄 HDBSCAN throughout (respects variable cluster shapes)`);
    
    if (outlierCluster.length === 0) {
      console.log("\n🎉 Full coverage: All notes are now clustered!");
    } else {
      const outlierPct = ((outlierCluster.length / clusterResult.totalNotes) * 100).toFixed(1);
      console.log(`\n💡 Semantic preservation: ${outlierPct}% of notes remain as outliers`);
      console.log(`   These have poor semantic fit with existing clusters`);
      console.log(`\n   To increase coverage, try:`);
      console.log(`   • Decreasing minClusterSize (e.g., --min-size=1)`);
      console.log(`   \n   To improve semantic accuracy, try:`);
      console.log(`   • Increasing minClusterSize (e.g., --min-size=5)`);
    }
    
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
  
  process.exit(0);
}

twoPassClusteringV2();
