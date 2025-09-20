// scripts/preprocess-course-v4.js
// Preprocessing AVANZATO del PDF del corso con AI e Vector DB

import { config } from 'dotenv';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import pdf from 'pdf-parse';
import pdfLib from 'pdf-lib';
import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

config();

// ============ CONFIGURAZIONE ============
const CONFIG = {
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4-turbo-preview',
        embeddingModel: 'text-embedding-3-large',
        temperature: 0.1,
        maxTokensPerRequest: 4000
    },
    pinecone: {
        apiKey: process.env.PINECONE_API_KEY,
        environment: process.env.PINECONE_ENVIRONMENT || 'us-east-1-aws',
        indexName: 'quiz-course-v4',
        dimension: 3072, // dimensione per text-embedding-3-large
        metric: 'cosine'
    },
    processing: {
        chunkSize: 800,          // Token per chunk
        chunkOverlap: 200,       // Overlap tra chunks
        minChunkSize: 100,       // Dimensione minima chunk
        batchSize: 10,           // Chunks per batch di processing
        imageExtractDPI: 300,    // DPI per estrazione immagini
        ocrLanguages: 'ita+eng', // Lingue per OCR
    },
    paths: {
        sourcePDF: './data/source/corso_completo.pdf',
        outputBase: './data/processed-v4/',
        chunks: './data/processed-v4/chunks/',
        embeddings: './data/processed-v4/embeddings/',
        images: './data/processed-v4/extracted-images/',
        index: './data/processed-v4/index/',
        metadata: './data/processed-v4/metadata.json'
    }
};

// ============ SERVIZI AI ============
class AIServices {
    constructor() {
        this.openai = null;
        this.pinecone = null;
        this.pineconeIndex = null;
    }

    async initialize() {
        console.log('🚀 Inizializzazione servizi AI...');
        
        // OpenAI
        this.openai = new OpenAI({
            apiKey: CONFIG.openai.apiKey
        });
        console.log('✅ OpenAI GPT-4 connesso');

        // Pinecone
        this.pinecone = new Pinecone({
            apiKey: CONFIG.pinecone.apiKey,
            environment: CONFIG.pinecone.environment
        });

        await this.initializePineconeIndex();
        console.log('✅ Pinecone Vector DB pronto');
    }

    async initializePineconeIndex() {
        const indexName = CONFIG.pinecone.indexName;
        
        try {
            const indexes = await this.pinecone.listIndexes();
            const indexExists = indexes.indexes?.some(idx => idx.name === indexName);

            if (!indexExists) {
                console.log('📦 Creazione nuovo indice Pinecone...');
                await this.pinecone.createIndex({
                    name: indexName,
                    dimension: CONFIG.pinecone.dimension,
                    metric: CONFIG.pinecone.metric,
                    spec: {
                        serverless: {
                            cloud: 'aws',
                            region: 'us-east-1'
                        }
                    }
                });
                
                // Attendi che l'indice sia pronto
                console.log('⏳ Attesa inizializzazione indice (30s)...');
                await new Promise(resolve => setTimeout(resolve, 30000));
            }

            this.pineconeIndex = this.pinecone.index(indexName);
            
            // Verifica stato indice
            const indexStats = await this.pineconeIndex.describeIndexStats();
            console.log(`📊 Indice Pinecone: ${indexStats.totalRecordCount || 0} vettori esistenti`);
            
        } catch (error) {
            console.error('❌ Errore Pinecone:', error);
            throw error;
        }
    }
}

// ============ ESTRAZIONE AVANZATA PDF CON VISION ============
class AdvancedPDFExtractor {
    constructor(openai) {
        this.openai = openai;
        this.pageContents = [];
        this.images = [];
        this.metadata = {};
        this.visionAnalysis = [];
    }

    async extractFromPDF(pdfPath) {
        console.log('\n📚 ESTRAZIONE AVANZATA DEL PDF DEL CORSO');
        console.log('=========================================\n');
        
        const pdfBuffer = await fs.readFile(pdfPath);
        
        // Estrazione testo base
        console.log('📄 Estrazione testo principale...');
        const pdfData = await pdf(pdfBuffer);
        
        // Parsing avanzato con pdf-lib per struttura
        console.log('🔍 Analisi struttura documento...');
        const pdfDoc = await pdfLib.PDFDocument.load(pdfBuffer);
        
        this.metadata = {
            title: pdfDoc.getTitle() || 'Corso Completo',
            author: pdfDoc.getAuthor() || 'Unknown',
            subject: pdfDoc.getSubject() || 'Informatica',
            keywords: pdfDoc.getKeywords() || '',
            totalPages: pdfDoc.getPageCount(),
            creationDate: pdfDoc.getCreationDate(),
            modificationDate: pdfDoc.getModificationDate()
        };
        
        console.log(`📊 Metadata: ${this.metadata.totalPages} pagine totali`);
        
        // Estrai contenuto per pagina con struttura
        const pages = pdfData.text.split(/\f/);
        
        for (let i = 0; i < pages.length; i++) {
            const pageText = pages[i];
            
            // Identifica struttura della pagina
            const structure = this.analyzePageStructure(pageText);
            
            this.pageContents.push({
                pageNumber: i + 1,
                text: pageText,
                structure: structure,
                hasImages: false, // Verrà aggiornato se troviamo immagini
                hasTables: this.detectTables(pageText),
                hasCode: this.detectCode(pageText),
                topics: [],  // Verrà popolato dall'analisi semantica
                visionEnhanced: false // Verrà aggiornato se analizzato con Vision
            });
            
            if ((i + 1) % 10 === 0) {
                console.log(`  Processate ${i + 1}/${pages.length} pagine...`);
            }
        }
        
        // Estrai e analizza immagini delle pagine con GPT-4 Vision
        await this.extractAndAnalyzeWithVision(pdfDoc, pdfBuffer);
        
        console.log(`✅ Estratte ${this.pageContents.length} pagine di contenuto`);
        if (this.visionAnalysis.length > 0) {
            console.log(`👁️ Analizzate ${this.visionAnalysis.length} pagine con Vision`);
        }
        
        return {
            pages: this.pageContents,
            images: this.images,
            metadata: this.metadata,
            visionAnalysis: this.visionAnalysis
        };
    }

    async extractAndAnalyzeWithVision(pdfDoc, pdfBuffer) {
        console.log('\n👁️ ANALISI PAGINE CON GPT-4 VISION');
        console.log('=====================================\n');
        
        // Importa libreria per conversione PDF->immagini
        const { pdf2pic } = await import('pdf2pic');
        const converter = pdf2pic({
            density: 150,
            savename: 'page',
            savedir: CONFIG.paths.images,
            format: 'jpg',
            width: 2000,
            height: 2800
        });
        
        const pages = pdfDoc.getPages();
        const pagesToAnalyze = [];
        
        // Identifica pagine che richiedono Vision
        for (let i = 0; i < this.pageContents.length; i++) {
            const page = this.pageContents[i];
            
            // Analizza con Vision se:
            // 1. Ha immagini/diagrammi
            // 2. Ha tabelle complesse
            // 3. Ha poco testo (probabile contenuto visuale)
            // 4. Ha formule matematiche (rilevate da pattern LaTeX)
            const needsVision = 
                page.hasImages || 
                page.hasTables ||
                page.text.length < 500 ||
                page.text.match(/\\[a-zA-Z]+{|\\frac|\\sum|\\int/) ||
                page.text.match(/[┌─┐│└┘├┤┬┴┼]/); // Box drawing chars
            
            if (needsVision) {
                pagesToAnalyze.push(i);
            }
        }
        
        console.log(`📸 ${pagesToAnalyze.length} pagine richiedono analisi Vision`);
        
        // Analizza pagine selezionate con Vision
        for (const pageIndex of pagesToAnalyze) {
            try {
                console.log(`  Analisi pagina ${pageIndex + 1}...`);
                
                // Converti pagina in immagine
                const pageImage = await converter.convertPage(pageIndex + 1, pdfBuffer);
                const imagePath = pageImage.path;
                
                // Leggi immagine e converti in base64
                const imageBuffer = await fs.readFile(imagePath);
                const base64Image = imageBuffer.toString('base64');
                
                // Analizza con GPT-4 Vision
                const visionResult = await this.analyzePageWithVision(
                    base64Image, 
                    pageIndex + 1,
                    this.pageContents[pageIndex]
                );
                
                if (visionResult) {
                    // Arricchisci dati della pagina
                    this.pageContents[pageIndex].visionEnhanced = true;
                    this.pageContents[pageIndex].visionData = visionResult;
                    
                    // Aggiungi testo estratto da Vision se manca nel PDF
                    if (visionResult.extractedText && this.pageContents[pageIndex].text.length < 100) {
                        this.pageContents[pageIndex].text += '\n\n[Vision Enhanced Content]\n' + visionResult.extractedText;
                    }
                    
                    // Aggiungi topics e concetti identificati da Vision
                    if (visionResult.concepts) {
                        this.pageContents[pageIndex].topics.push(...visionResult.topics || []);
                    }
                    
                    this.visionAnalysis.push({
                        pageNumber: pageIndex + 1,
                        analysis: visionResult
                    });
                }
                
                // Limita rate per evitare throttling
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                console.error(`  ⚠️ Errore Vision pagina ${pageIndex + 1}:`, error.message);
            }
        }
    }

    async analyzePageWithVision(base64Image, pageNumber, pageContent) {
        try {
            const response = await this.openai.chat.completions.create({
                model: CONFIG.openai.visionModel || 'gpt-4-vision-preview',
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: `Analizza questa pagina di un corso di informatica.

Contesto testo OCR base: "${pageContent.text.substring(0, 500)}..."

Estrai e struttura:
1. CONTENUTO VISUALE (diagrammi, schemi, flowchart)
2. TABELLE con struttura completa
3. FORMULE matematiche o algoritmi
4. CODICE con sintassi e indentazione
5. CONCETTI CHIAVE illustrati visivamente
6. RELAZIONI tra elementi (frecce, connessioni)
7. TESTO non catturato dall'OCR base

Rispondi in JSON:
{
  "pageType": "text|diagram|table|code|mixed",
  "visualElements": [
    {
      "type": "diagram|table|formula|code|chart",
      "description": "descrizione dettagliata",
      "content": "contenuto testuale se applicabile",
      "importance": 1-10
    }
  ],
  "extractedText": "testo aggiuntivo non nell'OCR",
  "tables": [
    {
      "headers": [],
      "rows": [],
      "description": ""
    }
  ],
  "formulas": [
    {
      "latex": "",
      "description": "",
      "variables": []
    }
  ],
  "code": [
    {
      "language": "",
      "content": "",
      "purpose": ""
    }
  ],
  "concepts": [
    {
      "name": "",
      "visualRepresentation": "",
      "relatedTo": []
    }
  ],
  "topics": [],
  "summary": "riassunto del contenuto visuale"
}`
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:image/jpeg;base64,${base64Image}`,
                                    detail: 'high'
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 4000,
                temperature: 0.1
            });

            const result = JSON.parse(response.choices[0].message.content);
            console.log(`    ✅ Pagina ${pageNumber}: ${result.pageType} - ${result.visualElements?.length || 0} elementi visuali`);
            return result;
            
        } catch (error) {
            console.error(`    ❌ Errore Vision Analysis:`, error.message);
            return null;
        }
    }

    analyzePageStructure(text) {
        const structure = {
            hasTitle: false,
            sections: [],
            paragraphs: 0,
            lists: 0,
            definitions: 0
        };
        
        const lines = text.split('\n');
        
        for (const line of lines) {
            // Rileva titoli (tutto maiuscolo o pattern specifici)
            if (line.match(/^[A-Z\s]{10,}$/) || line.match(/^\d+\.\s+[A-Z]/)) {
                structure.hasTitle = true;
                structure.sections.push(line.trim());
            }
            
            // Rileva liste
            if (line.match(/^[\s]*[-•·]\s+/) || line.match(/^[\s]*\d+\)\s+/)) {
                structure.lists++;
            }
            
            // Rileva definizioni (pattern "termine: definizione")
            if (line.match(/^[A-Z][^:]+:\s+/)) {
                structure.definitions++;
            }
            
            // Conta paragrafi
            if (line.length > 50 && !line.match(/^[\s]*[-•·\d]/)) {
                structure.paragraphs++;
            }
        }
        
        return structure;
    }

    detectTables(text) {
        // Euristica per rilevare tabelle
        const lines = text.split('\n');
        let consecutivePipes = 0;
        
        for (const line of lines) {
            if (line.includes('|') || line.match(/\t{2,}/)) {
                consecutivePipes++;
                if (consecutivePipes >= 3) return true;
            } else {
                consecutivePipes = 0;
            }
        }
        
        return false;
    }

    detectCode(text) {
        // Rileva blocchi di codice
        return text.includes('```') || 
               text.match(/\b(function|class|def|import|var|let|const)\b/) ||
               text.match(/[{}\[\]();].*[{}\[\]();]/);
    }

    async extractImages(pdfDoc) {
        console.log('🖼️ Ricerca immagini nel PDF...');
        
        const pages = pdfDoc.getPages();
        let imageCount = 0;
        
        for (let i = 0; i < pages.length; i++) {
            try {
                const page = pages[i];
                const xObjects = page.node.Resources?.XObject;
                
                if (xObjects) {
                    const xObjectKeys = Object.keys(xObjects);
                    
                    for (const key of xObjectKeys) {
                        const xObject = xObjects[key];
                        if (xObject && xObject.Subtype === 'Image') {
                            imageCount++;
                            this.pageContents[i].hasImages = true;
                            
                            // Salva riferimento all'immagine
                            this.images.push({
                                pageNumber: i + 1,
                                imageId: `img_p${i + 1}_${imageCount}`,
                                width: xObject.Width,
                                height: xObject.Height
                            });
                        }
                    }
                }
            } catch (error) {
                // Continua se non riesce ad estrarre immagini da una pagina
            }
        }
    }
}

// ============ ANALISI SEMANTICA CON GPT-4 ============
class SemanticAnalyzer {
    constructor(openai) {
        this.openai = openai;
        this.conceptMap = new Map();
        this.topicHierarchy = {};
    }

    async analyzeContent(pageContent, context = null) {
        const prompt = `Analizza questo contenuto di un corso di informatica.
        
${context ? `Contesto precedente: ${context}` : ''}

Contenuto da analizzare:
${pageContent.text.substring(0, 3000)}

Identifica e struttura:
1. CONCETTI CHIAVE con definizioni precise
2. ARGOMENTI PRINCIPALI trattati
3. RELAZIONI tra concetti
4. ESEMPI PRATICI o casi d'uso
5. FORMULE o ALGORITMI importanti
6. POSSIBILI DOMANDE D'ESAME su questo contenuto

Rispondi in JSON con questa struttura:
{
  "mainTopic": "argomento principale",
  "concepts": [
    {
      "term": "termine",
      "definition": "definizione completa",
      "importance": 1-10,
      "category": "categoria"
    }
  ],
  "relationships": [
    {"from": "concetto1", "to": "concetto2", "type": "relazione"}
  ],
  "examples": ["esempio1", "esempio2"],
  "formulas": ["formula1", "formula2"],
  "potentialQuestions": [
    {
      "question": "domanda",
      "difficulty": 1-5,
      "type": "multiple-choice|true-false|open",
      "concepts": ["concetto1", "concetto2"]
    }
  ],
  "summary": "riassunto in 2-3 frasi"
}`;

        try {
            const response = await this.openai.chat.completions.create({
                model: CONFIG.openai.model,
                messages: [
                    { 
                        role: 'system', 
                        content: 'Sei un esperto analizzatore di contenuti didattici di informatica. Estrai informazioni strutturate e precise.'
                    },
                    { role: 'user', content: prompt }
                ],
                temperature: CONFIG.openai.temperature,
                response_format: { type: "json_object" },
                max_tokens: CONFIG.openai.maxTokensPerRequest
            });

            const analysis = JSON.parse(response.choices[0].message.content);
            
            // Aggiorna mappa dei concetti
            for (const concept of analysis.concepts) {
                this.conceptMap.set(concept.term.toLowerCase(), concept);
            }
            
            // Aggiorna gerarchia degli argomenti
            if (!this.topicHierarchy[analysis.mainTopic]) {
                this.topicHierarchy[analysis.mainTopic] = [];
            }
            this.topicHierarchy[analysis.mainTopic].push(...analysis.concepts.map(c => c.term));
            
            return analysis;
            
        } catch (error) {
            console.error('❌ Errore analisi semantica:', error.message);
            return null;
        }
    }

    async generateEmbedding(text) {
        try {
            const response = await this.openai.embeddings.create({
                model: CONFIG.openai.embeddingModel,
                input: text.substring(0, 8000), // Limita lunghezza per embedding
            });
            
            return response.data[0].embedding;
        } catch (error) {
            console.error('❌ Errore generazione embedding:', error.message);
            return null;
        }
    }
}

// ============ CHUNKING INTELLIGENTE ============
class IntelligentChunker {
    constructor(analyzer) {
        this.analyzer = analyzer;
        this.chunks = [];
    }

    async createSemanticChunks(pdfData) {
        console.log('\n🧩 CREAZIONE CHUNKS SEMANTICI INTELLIGENTI');
        console.log('==========================================\n');
        
        let globalChunkId = 0;
        
        for (const page of pdfData.pages) {
            console.log(`📄 Chunking pagina ${page.pageNumber}...`);
            
            // Analisi semantica della pagina
            const semanticAnalysis = await this.analyzer.analyzeContent(page);
            
            if (semanticAnalysis) {
                page.topics = [semanticAnalysis.mainTopic];
                page.concepts = semanticAnalysis.concepts;
            }
            
            // Crea chunks basati sulla struttura semantica
            const pageChunks = this.smartChunkPage(page, semanticAnalysis);
            
            for (const chunk of pageChunks) {
                // Genera embedding per il chunk
                const embedding = await this.analyzer.generateEmbedding(chunk.text);
                
                this.chunks.push({
                    id: `chunk_${globalChunkId++}`,
                    pageNumber: page.pageNumber,
                    text: chunk.text,
                    topic: chunk.topic,
                    concepts: chunk.concepts,
                    importance: chunk.importance,
                    embedding: embedding,
                    metadata: {
                        hasCode: page.hasCode,
                        hasTables: page.hasTables,
                        hasImages: page.hasImages,
                        section: chunk.section
                    }
                });
                
                if (globalChunkId % 10 === 0) {
                    console.log(`  ✅ Creati ${globalChunkId} chunks...`);
                }
            }
        }
        
        console.log(`\n✅ Totale: ${this.chunks.length} chunks semantici creati`);
        return this.chunks;
    }

    smartChunkPage(page, analysis) {
        const chunks = [];
        const text = page.text;
        const sections = this.identifySections(text);
        
        for (const section of sections) {
            // Non spezzare sezioni piccole
            if (section.content.length < CONFIG.processing.chunkSize) {
                chunks.push({
                    text: section.content,
                    topic: analysis?.mainTopic || 'General',
                    concepts: this.extractRelevantConcepts(section.content, analysis),
                    importance: this.calculateImportance(section, analysis),
                    section: section.title
                });
            } else {
                // Spezza sezioni grandi mantenendo coerenza semantica
                const subChunks = this.splitLargeSection(section, analysis);
                chunks.push(...subChunks);
            }
        }
        
        return chunks;
    }

    identifySections(text) {
        const sections = [];
        const lines = text.split('\n');
        
        let currentSection = {
            title: 'Introduzione',
            content: '',
            startLine: 0
        };
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Rileva nuovo titolo di sezione
            if (this.isSectionTitle(line)) {
                if (currentSection.content.trim()) {
                    sections.push(currentSection);
                }
                currentSection = {
                    title: line.trim(),
                    content: '',
                    startLine: i
                };
            } else {
                currentSection.content += line + '\n';
            }
        }
        
        // Aggiungi ultima sezione
        if (currentSection.content.trim()) {
            sections.push(currentSection);
        }
        
        return sections;
    }

    isSectionTitle(line) {
        return line.match(/^[A-Z\s]{10,}$/) || 
               line.match(/^\d+\.\s+[A-Z]/) ||
               line.match(/^#{1,3}\s+/);
    }

    splitLargeSection(section, analysis) {
        const chunks = [];
        const paragraphs = section.content.split(/\n\n+/);
        
        let currentChunk = {
            text: '',
            topic: analysis?.mainTopic || 'General',
            concepts: [],
            importance: 5,
            section: section.title
        };
        
        for (const paragraph of paragraphs) {
            if (currentChunk.text.length + paragraph.length > CONFIG.processing.chunkSize) {
                // Salva chunk corrente
                if (currentChunk.text.trim()) {
                    currentChunk.concepts = this.extractRelevantConcepts(currentChunk.text, analysis);
                    currentChunk.importance = this.calculateImportance(currentChunk, analysis);
                    chunks.push(currentChunk);
                }
                
                // Inizia nuovo chunk con overlap
                const overlap = this.getOverlapText(currentChunk.text);
                currentChunk = {
                    text: overlap + '\n\n' + paragraph,
                    topic: analysis?.mainTopic || 'General',
                    concepts: [],
                    importance: 5,
                    section: section.title
                };
            } else {
                currentChunk.text += '\n\n' + paragraph;
            }
        }
        
        // Aggiungi ultimo chunk
        if (currentChunk.text.trim()) {
            currentChunk.concepts = this.extractRelevantConcepts(currentChunk.text, analysis);
            currentChunk.importance = this.calculateImportance(currentChunk, analysis);
            chunks.push(currentChunk);
        }
        
        return chunks;
    }

    getOverlapText(text) {
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
        const overlapSentences = sentences.slice(-2);
        return overlapSentences.join(' ').substring(0, CONFIG.processing.chunkOverlap);
    }

    extractRelevantConcepts(text, analysis) {
        if (!analysis || !analysis.concepts) return [];
        
        const textLower = text.toLowerCase();
        return analysis.concepts
            .filter(concept => textLower.includes(concept.term.toLowerCase()))
            .map(c => c.term);
    }

    calculateImportance(section, analysis) {
        let importance = 5; // Default
        
        // Aumenta importanza se contiene definizioni
        if (section.text && section.text.match(/:\s+/g)?.length > 2) {
            importance += 2;
        }
        
        // Aumenta se contiene concetti chiave
        if (analysis && analysis.concepts) {
            const highImportanceConcepts = analysis.concepts.filter(c => c.importance >= 8);
            if (highImportanceConcepts.length > 0) {
                importance += 2;
            }
        }
        
        // Aumenta se è una sezione principale
        if (section.section && section.section.match(/^[A-Z\s]{10,}$/)) {
            importance += 1;
        }
        
        return Math.min(importance, 10);
    }
}

// ============ VECTOR DATABASE INDEXING ============
class VectorIndexer {
    constructor(pineconeIndex) {
        this.index = pineconeIndex;
        this.stats = {
            indexed: 0,
            failed: 0,
            batches: 0
        };
    }

    async indexChunks(chunks) {
        console.log('\n🚀 INDICIZZAZIONE IN PINECONE VECTOR DB');
        console.log('========================================\n');
        
        const batchSize = CONFIG.processing.batchSize;
        const totalBatches = Math.ceil(chunks.length / batchSize);
        
        for (let i = 0; i < chunks.length; i += batchSize) {
            const batch = chunks.slice(i, i + batchSize);
            const batchNum = Math.floor(i / batchSize) + 1;
            
            console.log(`📦 Batch ${batchNum}/${totalBatches} (${batch.length} chunks)...`);
            
            const vectors = [];
            
            for (const chunk of batch) {
                if (!chunk.embedding) {
                    console.log(`  ⚠️ Skip chunk ${chunk.id}: no embedding`);
                    this.stats.failed++;
                    continue;
                }
                
                vectors.push({
                    id: chunk.id,
                    values: chunk.embedding,
                    metadata: {
                        text: chunk.text.substring(0, 1000), // Limita per metadata
                        pageNumber: chunk.pageNumber,
                        topic: chunk.topic,
                        concepts: chunk.concepts.join(', '),
                        importance: chunk.importance,
                        hasCode: chunk.metadata.hasCode,
                        hasTables: chunk.metadata.hasTables,
                        section: chunk.metadata.section
                    }
                });
            }
            
            if (vectors.length > 0) {
                try {
                    await this.index.upsert(vectors);
                    this.stats.indexed += vectors.length;
                    this.stats.batches++;
                    console.log(`  ✅ Indicizzati ${vectors.length} vettori`);
                } catch (error) {
                    console.error(`  ❌ Errore batch ${batchNum}:`, error.message);
                    this.stats.failed += vectors.length;
                }
            }
            
            // Pausa tra batch per evitare rate limiting
            if (i + batchSize < chunks.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        console.log('\n📊 STATISTICHE INDICIZZAZIONE:');
        console.log(`  ✅ Indicizzati: ${this.stats.indexed} chunks`);
        console.log(`  ❌ Falliti: ${this.stats.failed} chunks`);
        console.log(`  📦 Batch processati: ${this.stats.batches}`);
        
        return this.stats;
    }
}

// ============ SALVATAGGIO DATI PROCESSATI ============
class DataSaver {
    async saveProcessedData(chunks, metadata, indexStats) {
        console.log('\n💾 SALVATAGGIO DATI PROCESSATI');
        console.log('==============================\n');
        
        // Crea directory
        await this.createDirectories();
        
        // Salva chunks in file separati per efficienza
        await this.saveChunks(chunks);
        
        // Salva metadata completo
        await this.saveMetadata(metadata, indexStats, chunks);
        
        // Crea indice di ricerca locale
        await this.createSearchIndex(chunks);
        
        console.log('✅ Tutti i dati salvati in /data/processed-v4/');
    }

    async createDirectories() {
        for (const dir of Object.values(CONFIG.paths)) {
            if (dir.endsWith('.json') || dir.endsWith('.pdf')) continue;
            await fs.mkdir(dir, { recursive: true });
        }
    }

    async saveChunks(chunks) {
        const chunksPerFile = 100;
        let fileIndex = 0;
        
        for (let i = 0; i < chunks.length; i += chunksPerFile) {
            const batch = chunks.slice(i, i + chunksPerFile);
            
            // Rimuovi embeddings per risparmiare spazio
            const chunksToSave = batch.map(chunk => ({
                ...chunk,
                embedding: undefined // Non salvare embeddings (già in Pinecone)
            }));
            
            const filePath = path.join(CONFIG.paths.chunks, `chunks_${fileIndex}.json`);
            await fs.writeFile(filePath, JSON.stringify(chunksToSave, null, 2));
            
            console.log(`  📄 Salvato ${filePath} (${chunksToSave.length} chunks)`);
            fileIndex++;
        }
    }

    async saveMetadata(pdfMetadata, indexStats, chunks) {
        // Calcola statistiche
        const topics = new Set();
        const concepts = new Set();
        let totalImportance = 0;
        
        for (const chunk of chunks) {
            if (chunk.topic) topics.add(chunk.topic);
            if (chunk.concepts) {
                chunk.concepts.forEach(c => concepts.add(c));
            }
            totalImportance += chunk.importance || 5;
        }
        
        const metadata = {
            version: '4.0',
            created_at: new Date().toISOString(),
            source: {
                file: 'corso_completo.pdf',
                ...pdfMetadata
            },
            processing: {
                model: CONFIG.openai.model,
                embeddingModel: CONFIG.openai.embeddingModel,
                chunkSize: CONFIG.processing.chunkSize,
                chunkOverlap: CONFIG.processing.chunkOverlap
            },
            statistics: {
                totalChunks: chunks.length,
                totalPages: pdfMetadata.totalPages,
                uniqueTopics: topics.size,
                uniqueConcepts: concepts.size,
                averageImportance: (totalImportance / chunks.length).toFixed(2),
                vectorsIndexed: indexStats.indexed,
                indexingFailed: indexStats.failed
            },
            topics: Array.from(topics),
            concepts: Array.from(concepts).slice(0, 100) // Top 100 concetti
        };
        
        await fs.writeFile(CONFIG.paths.metadata, JSON.stringify(metadata, null, 2));
        console.log('  📊 Metadata salvato');
    }

    async createSearchIndex(chunks) {
        // Crea indice invertito per ricerca veloce locale
        const index = {
            terms: {},     // termine -> [chunk_ids]
            concepts: {},  // concetto -> [chunk_ids]
            pages: {},     // pagina -> [chunk_ids]
            topics: {}     // topic -> [chunk_ids]
        };
        
        for (const chunk of chunks) {
            // Indicizza per termini
            const words = chunk.text.toLowerCase().split(/\s+/)
                .filter(w => w.length > 3)
                .slice(0, 50); // Primi 50 termini significativi
            
            for (const word of words) {
                if (!index.terms[word]) index.terms[word] = [];
                index.terms[word].push(chunk.id);
            }
            
            // Indicizza per concetti
            for (const concept of chunk.concepts || []) {
                const conceptLower = concept.toLowerCase();
                if (!index.concepts[conceptLower]) index.concepts[conceptLower] = [];
                index.concepts[conceptLower].push(chunk.id);
            }
            
            // Indicizza per pagina
            const pageKey = `page_${chunk.pageNumber}`;
            if (!index.pages[pageKey]) index.pages[pageKey] = [];
            index.pages[pageKey].push(chunk.id);
            
            // Indicizza per topic
            if (chunk.topic) {
                if (!index.topics[chunk.topic]) index.topics[chunk.topic] = [];
                index.topics[chunk.topic].push(chunk.id);
            }
        }
        
        // Salva indice
        const indexPath = path.join(CONFIG.paths.index, 'search_index.json');
        await fs.writeFile(indexPath, JSON.stringify(index));
        console.log('  🔍 Indice di ricerca locale creato');
    }
}

// ============ PIPELINE PRINCIPALE ============
class CourseProcessingPipeline {
    constructor() {
        this.services = new AIServices();
        this.extractor = new AdvancedPDFExtractor();
        this.analyzer = null;
        this.chunker = null;
        this.indexer = null;
        this.saver = new DataSaver();
    }

    async run() {
        console.log('╔════════════════════════════════════════════════╗');
        console.log('║   PREPROCESSING CORSO v4 - AVANZATO CON AI     ║');
        console.log('╚════════════════════════════════════════════════╝\n');
        
        try {
            // 1. Inizializza servizi AI
            await this.services.initialize();
            this.analyzer = new SemanticAnalyzer(this.services.openai);
            this.chunker = new IntelligentChunker(this.analyzer);
            this.indexer = new VectorIndexer(this.services.pineconeIndex);
            
            // 2. Estrai contenuto dal PDF
            const pdfData = await this.extractor.extractFromPDF(CONFIG.paths.sourcePDF);
            
            // 3. Crea chunks semantici intelligenti
            const chunks = await this.chunker.createSemanticChunks(pdfData);
            
            // 4. Indicizza in Pinecone
            const indexStats = await this.indexer.indexChunks(chunks);
            
            // 5. Salva dati processati
            await this.saver.saveProcessedData(chunks, pdfData.metadata, indexStats);
            
            // 6. Report finale
            this.printFinalReport(chunks, indexStats);
            
        } catch (error) {
            console.error('\n❌ ERRORE FATALE:', error);
            console.error(error.stack);
            process.exit(1);
        }
    }

    printFinalReport(chunks, indexStats) {
        console.log('\n╔════════════════════════════════════════════════╗');
        console.log('║           PREPROCESSING COMPLETATO              ║');
        console.log('╚════════════════════════════════════════════════╝\n');
        
        console.log('📊 RISULTATI FINALI:');
        console.log('===================');
        console.log(`  📚 Chunks totali creati: ${chunks.length}`);
        console.log(`  🎯 Chunks indicizzati: ${indexStats.indexed}`);
        console.log(`  🧠 Concetti unici estratti: ${this.analyzer.conceptMap.size}`);
        console.log(`  📝 Topics identificati: ${Object.keys(this.analyzer.topicHierarchy).length}`);
        console.log(`  💾 Dati salvati in: ${CONFIG.paths.outputBase}`);
        console.log('\n✨ Il corso è ora ottimizzato per ricerca semantica veloce!');
        console.log('🚀 Usa /api/analyze-v4-rag per analisi quiz con RAG\n');
    }
}

// ============ ESECUZIONE ============
async function main() {
    const pipeline = new CourseProcessingPipeline();
    await pipeline.run();
}

// Esegui se chiamato direttamente
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { CourseProcessingPipeline };