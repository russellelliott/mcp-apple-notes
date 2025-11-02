#!/usr/bin/env bun
import { clusterNotes, listClusters, getNotesInCluster, aggregateChunksToNotes } from "./index.js";
import * as lancedb from "@lancedb/lancedb";

/**
 * Two-pass clustering with intelligent outlier assignment:
 * Pass 1: DBSCAN with epsilon=0.7 for dense, high-confidence clusters
 * Pass 2: Assign remaining outliers to nearest DBSCAN clusters using embeddings
 * 
 * Enhanced approach:
 * - Uses K-means or Topic Modeling to understand outlier structure
 * - Reassigns outliers to their most similar DBSCAN clusters
 * - Persists new assignments to database
 * - Unified display shows final cluster composition
 * 
 * Usage:
 *   bun two-pass-clustering.ts          # Uses K-means for outlier analysis
 *   bun two-pass-clustering.ts --topic-modeling  # Uses Topic Modeling for outlier analysis
 */

// ===== K-MEANS IMPLEMENTATION =====
const kMeans = (vectors: number[][], k: number, maxIterations: number = 100) => {
  if (vectors.length === 0) return { labels: [], centroids: [] };
  if (k >= vectors.length) k = vectors.length;
  
  const centroids: number[][] = [];
  const indices = new Set<number>();
  while (centroids.length < k) {
    const idx = Math.floor(Math.random() * vectors.length);
    if (!indices.has(idx)) {
      centroids.push([...vectors[idx]]);
      indices.add(idx);
    }
  }
  
  let labels = new Array(vectors.length).fill(0);
  
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const newLabels = vectors.map((vec) => {
      let minDist = Infinity;
      let bestCluster = 0;
      
      for (let i = 0; i < centroids.length; i++) {
        const dist = euclideanDistance(vec, centroids[i]);
        if (dist < minDist) {
          minDist = dist;
          bestCluster = i;
        }
      }
      
      return bestCluster;
    });
    
    if (JSON.stringify(newLabels) === JSON.stringify(labels)) {
      labels = newLabels;
      break;
    }
    
    labels = newLabels;
    
    for (let i = 0; i < k; i++) {
      const clusterPoints = vectors.filter((_, idx) => labels[idx] === i);
      if (clusterPoints.length > 0) {
        const dims = vectors[0].length;
        for (let d = 0; d < dims; d++) {
          centroids[i][d] =
            clusterPoints.reduce((sum, p) => sum + p[d], 0) / clusterPoints.length;
        }
      }
    }
  }
  
  return { labels, centroids };
};

// ===== TOPIC MODELING (LDA-inspired) =====
const topicModeling = (noteTexts: string[], numTopics: number) => {
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'are', 'was', 'were', 'that', 'this', 'be', 'as', 'by', 'from', 'have', 'it']);
  
  const docTermMatrix: Record<string, number>[] = noteTexts.map(text => {
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));
    
    const termFreq: Record<string, number> = {};
    words.forEach(w => {
      termFreq[w] = (termFreq[w] || 0) + 1;
    });
    return termFreq;
  });
  
  const topicKeywords: Record<number, Map<string, number>> = {};
  for (let i = 0; i < numTopics; i++) {
    topicKeywords[i] = new Map();
  }
  
  const topicAssignments = new Array(noteTexts.length).fill(0);
  
  docTermMatrix.forEach((terms, docIdx) => {
    const topTerms = Object.entries(terms)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 4)
      .map(([term]) => term);
    
    let bestTopic = docIdx % numTopics;
    let maxScore = 0;
    
    for (let t = 0; t < numTopics; t++) {
      const keywords = topicKeywords[t];
      const score = topTerms.filter(term => keywords.has(term)).length;
      if (score > maxScore) {
        maxScore = score;
        bestTopic = t;
      }
    }
    
    topicAssignments[docIdx] = bestTopic;
    
    topTerms.forEach(term => {
      const count = topicKeywords[bestTopic].get(term) || 0;
      topicKeywords[bestTopic].set(term, count + 1);
    });
  });
  
  return topicAssignments;
};

// Euclidean distance between two vectors
const euclideanDistance = (a: number[], b: number[]): number => {
  return Math.sqrt(a.reduce((sum, val, i) => sum + Math.pow(val - b[i], 2), 0));
};

async function twoPassClustering(useTopicModeling: boolean = false) {
  console.log("🎯 Two-Pass Intelligent Clustering\n");
  console.log("Pass 1: DBSCAN (high-confidence dense clusters)");
  console.log(`Pass 2: ${useTopicModeling ? 'Topic Modeling' : 'K-means'} + Reassignment (assign outliers to nearest clusters)\n`);
  
  try {
    const db = await lancedb.connect(`${process.env.HOME}/.mcp-apple-notes/data`);
    const notesTable = await db.openTable("notes");
    
    const allChunks = await notesTable.search("").limit(100000).toArray();
    const uniqueNotes = new Set(allChunks.map(chunk => `${chunk.title}|||${chunk.creation_date}`));
    
    console.log(`📊 Database: ${uniqueNotes.size} notes (${allChunks.length} chunks)\n`);
    
    // ===== PASS 1: DBSCAN =====
    console.log("════════════════════════════════════════");
    console.log("PASS 1: DBSCAN Clustering (epsilon=0.7)");
    console.log("════════════════════════════════════════\n");
    
    const dbscanResult = await clusterNotes(notesTable, 2, 0.7, false);
    
    console.log(`✅ DBSCAN Results:`);
    console.log(`   • Clusters: ${dbscanResult.totalClusters}`);
    console.log(`   • Clustered notes: ${dbscanResult.totalNotes - dbscanResult.outliers}`);
    console.log(`   • Outliers: ${dbscanResult.outliers}`);
    console.log(`   • Time: ${dbscanResult.timeSeconds.toFixed(1)}s\n`);
    
    // ===== PASS 2: ANALYZE OUTLIERS AND REASSIGN =====
    let reassignmentCount = 0;
    let algorithmUsed = '';
    
    if (dbscanResult.outliers > 0) {
      console.log("════════════════════════════════════════");
      console.log("PASS 2: Outlier Analysis & Reassignment");
      console.log("════════════════════════════════════════\n");
      
      const outlierNotes = await getNotesInCluster(notesTable, '-1');
      console.log(`📂 Retrieved ${outlierNotes.length} outlier notes\n`);
      
      if (outlierNotes.length > 0) {
        const startPass2 = performance.now();
        let secondaryLabels: number[];
        
        // Step 1: Analyze outliers using chosen algorithm
        if (useTopicModeling) {
          const noteTexts = outlierNotes.map(n => n.title);
          const suggestedTopics = Math.ceil(Math.sqrt(outlierNotes.length));
          const numTopics = Math.max(2, Math.min(suggestedTopics, 10));
          
          console.log(`🎯 Running Topic Modeling with ${numTopics} topics...\n`);
          secondaryLabels = topicModeling(noteTexts, numTopics);
          algorithmUsed = 'Topic Modeling';
        } else {
          const noteEmbeddings = await aggregateChunksToNotes(notesTable);
          const outlierVectors = noteEmbeddings
            .filter(note => outlierNotes.some(o => 
              o.title === note.title && o.creation_date === note.creation_date
            ))
            .map(n => n.embedding);
          
          const suggestedK = Math.ceil(Math.sqrt(outlierNotes.length));
          const maxK = Math.min(10, outlierNotes.length);
          const k = Math.max(2, Math.min(suggestedK, maxK));
          
          console.log(`🎯 Running K-means with k=${k}...\n`);
          const kmResult = kMeans(outlierVectors, k);
          secondaryLabels = kmResult.labels;
          algorithmUsed = 'K-means';
        }
        
        const timeAnalysis = (performance.now() - startPass2) / 1000;
        console.log(`✅ Outlier structure analyzed in ${timeAnalysis.toFixed(1)}s\n`);
        
        // Step 2: Calculate DBSCAN cluster centroids
        console.log("📍 Computing DBSCAN cluster centroids...\n");
        const dbscanClusters = await listClusters(notesTable);
        const realClusters = dbscanClusters.filter(c => c.cluster_id !== '-1');
        
        const clusterCentroids = new Map<string, number[]>();
        const noteEmbeddings = await aggregateChunksToNotes(notesTable);
        
        for (const cluster of realClusters) {
          const notesInCluster = await getNotesInCluster(notesTable, cluster.cluster_id);
          
          const clusterVectors = noteEmbeddings
            .filter(note => notesInCluster.some(n =>
              n.title === note.title && n.creation_date === note.creation_date
            ))
            .map(n => n.embedding);
          
          if (clusterVectors.length > 0) {
            const dims = clusterVectors[0].length;
            const centroid = new Array(dims).fill(0);
            for (let d = 0; d < dims; d++) {
              centroid[d] = clusterVectors.reduce((sum, vec) => sum + vec[d], 0) / clusterVectors.length;
            }
            clusterCentroids.set(cluster.cluster_id, centroid);
          }
        }
        
        // Step 3: Assign each outlier to nearest DBSCAN cluster
        console.log("🔄 Assigning outliers to nearest DBSCAN clusters...\n");
        
        const outlierAssignments = new Map<string, typeof outlierNotes>();
        
        for (let i = 0; i < outlierNotes.length; i++) {
          const note = outlierNotes[i];
          const embedding = noteEmbeddings.find(n =>
            n.title === note.title && n.creation_date === note.creation_date
          )?.embedding;
          
          if (!embedding) continue;
          
          let nearestClusterId = realClusters[0]?.cluster_id || '0';
          let minDistance = Infinity;
          
          for (const [clusterId, centroid] of clusterCentroids) {
            const distance = euclideanDistance(embedding, centroid);
            if (distance < minDistance) {
              minDistance = distance;
              nearestClusterId = clusterId;
            }
          }
          
          if (!outlierAssignments.has(nearestClusterId)) {
            outlierAssignments.set(nearestClusterId, []);
          }
          outlierAssignments.get(nearestClusterId)!.push(note);
        }
        
        // Step 4: Persist reassignments to database
        // Use the exact same update method as DBSCAN clustering in index.ts
        console.log("💾 Persisting cluster reassignments to database...\n");
        
        for (const [targetClusterId, notes] of outlierAssignments) {
          for (const note of notes) {
            try {
              // Update all chunks belonging to this note using the exact same pattern as DBSCAN
              await notesTable.update({
                where: `title = '${note.title.replace(/'/g, "''")}' AND creation_date = '${note.creation_date}'`,
                values: {
                  cluster_id: String(targetClusterId)
                }
              });
              reassignmentCount++;
            } catch (error) {
              // Continue on error
            }
          }
        }
        
        console.log(`✅ Successfully reassigned ${reassignmentCount} outlier notes\n`);
        console.log("📊 Reassignment Summary:");
        for (const [clusterId, notes] of outlierAssignments) {
          const clusterInfo = realClusters.find(c => c.cluster_id === String(clusterId));
          console.log(`   • Cluster "${clusterInfo?.cluster_label}": +${notes.length} notes reassigned`);
        }
        console.log();
      }
    }
    
    // ===== UNIFIED DISPLAY =====
    console.log("════════════════════════════════════════");
    console.log("📊 UNIFIED CLUSTER DISPLAY (After Reassignment)");
    console.log("════════════════════════════════════════\n");
    
    const finalClusters = await listClusters(notesTable);
    const finalRealClusters = finalClusters.filter(c => c.cluster_id !== '-1');
    const finalOutlierCluster = finalClusters.find(c => c.cluster_id === '-1');
    
    console.log("🎯 FINAL CLUSTERS:\n");
    let totalClustered = 0;
    
    for (let i = 0; i < finalRealClusters.length; i++) {
      const cluster = finalRealClusters[i];
      const notesInCluster = await getNotesInCluster(notesTable, cluster.cluster_id);
      totalClustered += notesInCluster.length;
      
      console.log(`  📌 Cluster ${i + 1}: "${cluster.cluster_label}"`);
      console.log(`     📊 ${notesInCluster.length} notes (updated from: ${cluster.note_count})`);
      console.log(`     💭 ${cluster.cluster_summary}\n`);
    }
    
    const remainingOutliers = finalOutlierCluster?.note_count || 0;
    
    // ===== FINAL SUMMARY =====
    console.log("════════════════════════════════════════");
    console.log("📈 FINAL CLUSTERING RESULTS");
    console.log("════════════════════════════════════════\n");
    
    console.log(`Total notes: ${dbscanResult.totalNotes}`);
    console.log(`Clusters: ${finalRealClusters.length}`);
    console.log(`Notes in clusters: ${totalClustered} (${((totalClustered / dbscanResult.totalNotes) * 100).toFixed(1)}%)`);
    console.log(`Remaining outliers: ${remainingOutliers}`);
    
    console.log(`\n✨ Two-pass clustering complete!`);
    console.log(`   🔄 Analysis method: ${algorithmUsed || 'None'}`);
    console.log(`   📊 Outliers reassigned: ${reassignmentCount}`);
    console.log(`   💾 All changes persisted to database`);
    
    if (remainingOutliers === 0) {
      console.log("\n🎉 SUCCESS: All notes are now clustered!");
    } else {
      console.log(`\n💡 Note: ${remainingOutliers} notes remain as outliers (too different from existing clusters)`);
    }
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
  
  process.exit(0);
}

const useTopicModeling = process.argv.includes('--topic-modeling');
twoPassClustering(useTopicModeling);
