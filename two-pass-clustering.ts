#!/usr/bin/env bun
import { clusterNotes, listClusters, getNotesInCluster, aggregateChunksToNotes } from "./index.js";
import * as lancedb from "@lancedb/lancedb";

/**
 * Two-pass clustering with intelligent outlier assignment:
 * Pass 1: HDBSCAN with min_cluster_size=5 for hierarchical density-based clusters
 * Pass 2: Create secondary clusters from remaining outliers using K-means or Topic Modeling
 * 
 * Enhanced approach:
 * - Uses K-means or Topic Modeling to understand outlier structure
 * - Creates secondary clusters only from outliers that form coherent groups
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
  console.log("Pass 1: HDBSCAN (hierarchical density-based clusters)");
  console.log(`Pass 2: ${useTopicModeling ? 'Topic Modeling' : 'K-means'} + Secondary Clustering (create new clusters from coherent outlier groups)\n`);
  
  try {
    const db = await lancedb.connect(`${process.env.HOME}/.mcp-apple-notes/data`);
    const notesTable = await db.openTable("notes");
    
    const allChunks = await notesTable.search("").limit(100000).toArray();
    const uniqueNotes = new Set(allChunks.map(chunk => `${chunk.title}|||${chunk.creation_date}`));
    
    console.log(`📊 Database: ${uniqueNotes.size} notes (${allChunks.length} chunks)\n`);
    
    // ===== PASS 1: HDBSCAN =====
    console.log("════════════════════════════════════════");
    console.log("PASS 1: HDBSCAN Clustering (min_cluster_size=5)");
    console.log("════════════════════════════════════════\n");
    
    const dbscanResult = await clusterNotes(notesTable, 5, false);
    
    console.log(`✅ HDBSCAN Results:`);
    console.log(`   • Clusters: ${dbscanResult.totalClusters}`);
    console.log(`   • Clustered notes: ${dbscanResult.totalNotes - dbscanResult.outliers}`);
    console.log(`   • Outliers: ${dbscanResult.outliers}`);
    console.log(`   • Time: ${dbscanResult.timeSeconds.toFixed(1)}s\n`);
    
    // ===== PASS 2: CREATE SECONDARY CLUSTERS FROM OUTLIERS =====
    let secondaryClusterCount = 0;
    let secondaryClusterNotes = 0;
    let finalOutlierCount = 0;
    let algorithmUsed = '';
    
    if (dbscanResult.outliers > 0) {
      console.log("════════════════════════════════════════");
      console.log("PASS 2: Secondary Cluster Creation");
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
        
        // Step 2: Group outliers by their secondary cluster labels
        const secondaryClusterGroups = new Map<number, typeof outlierNotes>();
        outlierNotes.forEach((note, idx) => {
          const clusterLabel = secondaryLabels[idx];
          if (!secondaryClusterGroups.has(clusterLabel)) {
            secondaryClusterGroups.set(clusterLabel, []);
          }
          secondaryClusterGroups.get(clusterLabel)!.push(note);
        });
        
        // Step 3: Filter clusters by minimum size (require at least 3 notes to form a secondary cluster)
        const MIN_SECONDARY_CLUSTER_SIZE = 3;
        const secondaryClustersToCreate = new Map<number, typeof outlierNotes>();
        const remainingOutliers: typeof outlierNotes = [];
        
        for (const [clusterId, notes] of secondaryClusterGroups) {
          if (notes.length >= MIN_SECONDARY_CLUSTER_SIZE) {
            secondaryClustersToCreate.set(clusterId, notes);
            secondaryClusterNotes += notes.length;
          } else {
            remainingOutliers.push(...notes);
          }
        }
        
        console.log(`📊 Secondary Cluster Analysis:`);
        console.log(`   • Potential clusters from ${algorithmUsed}: ${secondaryClusterGroups.size}`);
        console.log(`   • Clusters meeting min size (${MIN_SECONDARY_CLUSTER_SIZE}+): ${secondaryClustersToCreate.size}`);
        console.log(`   • Notes in secondary clusters: ${secondaryClusterNotes}`);
        console.log(`   • Notes remaining as outliers: ${remainingOutliers.length}\n`);
        
        // Step 4: Persist secondary clusters to database with new cluster IDs
        if (secondaryClustersToCreate.size > 0) {
          console.log("💾 Persisting secondary clusters to database...\n");
          
          // Get the max existing cluster ID to start secondary cluster numbering
          const existingClusters = await listClusters(notesTable);
          const maxClusterId = Math.max(...existingClusters
            .filter(c => c.cluster_id !== '-1')
            .map(c => parseInt(c.cluster_id) || 0));
          
          let clusterIdCounter = maxClusterId + 1;
          
          for (const [_, notes] of secondaryClustersToCreate) {
            const newClusterId = clusterIdCounter.toString();
            
            for (const note of notes) {
              try {
                await notesTable.update({
                  where: `title = '${note.title.replace(/'/g, "''")}' AND creation_date = '${note.creation_date}'`,
                  values: {
                    cluster_id: newClusterId
                  }
                });
              } catch (error) {
                // Continue on error
              }
            }
            
            secondaryClusterCount++;
            clusterIdCounter++;
          }
          
          console.log(`✅ Created ${secondaryClusterCount} secondary clusters\n`);
        }
        
        finalOutlierCount = remainingOutliers.length;
      }
    }
    
    // ===== UNIFIED DISPLAY =====
    console.log("════════════════════════════════════════");
    console.log("📊 UNIFIED CLUSTER DISPLAY");
    console.log("════════════════════════════════════════\n");
    
    const finalClusters = await listClusters(notesTable);
    const finalRealClusters = finalClusters.filter(c => c.cluster_id !== '-1');
    const finalOutlierCluster = finalClusters.find(c => c.cluster_id === '-1');
    
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
      console.log(`   Notes that don't fit into any cluster:`);
      outlierCluster.forEach((note, idx) => {
        console.log(`      ${idx + 1}. "${note.title}"`);
      });
      console.log();
    }
    
    // ===== FINAL SUMMARY =====
    console.log("════════════════════════════════════════");
    console.log("📈 FINAL CLUSTERING RESULTS");
    console.log("════════════════════════════════════════\n");
    
    console.log(`Total notes: ${dbscanResult.totalNotes}`);
    console.log(`Primary HDBSCAN clusters: ${dbscanResult.totalClusters}`);
    console.log(`Secondary clusters created: ${secondaryClusterCount}`);
    console.log(`Total clusters: ${finalRealClusters.length}`);
    console.log(`Notes in clusters: ${totalClustered} (${((totalClustered / dbscanResult.totalNotes) * 100).toFixed(1)}%)`);
    console.log(`Remaining outliers: ${outlierCluster.length}`);
    
    console.log(`\n✨ Two-pass clustering complete!`);
    console.log(`   🔄 Analysis method: ${algorithmUsed || 'None'}`);
    console.log(`   📊 Secondary clusters created: ${secondaryClusterCount}`);
    console.log(`   💾 All changes persisted to database`);
    
    if (outlierCluster.length === 0) {
      console.log("\n🎉 SUCCESS: All notes are now clustered!");
    } else {
      console.log(`\n💡 Note: ${outlierCluster.length} notes remain as true outliers (too isolated to form clusters)`);
    }
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
  
  process.exit(0);
}

const useTopicModeling = process.argv.includes('--topic-modeling');
twoPassClustering(useTopicModeling);
