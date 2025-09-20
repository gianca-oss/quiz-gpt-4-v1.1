// scripts/vision-processing-config.js
// Configurazione ottimizzata per processing con GPT-4 Vision

export const VISION_CONFIG = {
    // Strategia di selezione pagine per Vision
    pageSelection: {
        // Analizza SEMPRE con Vision
        alwaysAnalyze: {
            // Prime e ultime pagine (spesso contengono indici/sommari)
            firstPages: 3,
            lastPages: 2,
            
            // Pagine con pattern specifici
            patterns: [
                /figura\s+\d+/i,        // Figure numerate
                /tabella\s+\d+/i,       // Tabelle numerate
                /grafico\s+\d+/i,       // Grafici
                /diagramma/i,           // Diagrammi
                /schema/i,              // Schemi
                /algoritmo/i,           // Algoritmi
                /flowchart/i,           // Flowchart
                /UML/,                  // Diagrammi UML
            ]
        },
        
        // Analizza SE soddisfa criteri
        conditionalAnalyze: {
            minTextLength: 200,        // Se testo < 200 chars (probabile immagine)
            maxTextDensity: 0.3,       // Se densità testo < 30% (molto visuale)
            hasSpecialChars: true,     // Se contiene box drawing o simboli
            hasMathSymbols: true,       // Se contiene simboli matematici
            hasCodeBlocks: true,        // Se sembra contenere codice
        },
        
        // Limiti per controllo costi
        limits: {
            maxPagesPerRun: 50,        // Max pagine per run
            maxPagesPerDocument: 100,   // Max totale per documento
            costPerPage: 0.01,         // Costo stimato per pagina ($)
            maxBudget: 5.00            // Budget massimo per documento ($)
        }
    },
    
    // Ottimizzazione immagini per Vision
    imageOptimization: {
        // Conversione PDF -> Immagine
        pdf2image: {
            density: 150,               // DPI (150 è buon compromesso)
            format: 'jpeg',            
            quality: 85,                // Qualità JPEG (85 è ottimale)
            maxWidth: 2000,             // Larghezza max
            maxHeight: 2800,            // Altezza max
        },
        
        // Pre-processing per Vision
        preprocessing: {
            enhanceContrast: true,     // Migliora contrasto
            sharpen: true,              // Aumenta nitidezza
            denoise: false,             // Rimuovi rumore (solo se necessario)
            deskew: true,               // Raddrizza pagine storte
            removeBackground: false,     // Rimuovi sfondo (può perdere info)
        },
        
        // Strategia di batching
        batching: {
            pagesPerBatch: 5,           // Pagine per batch
            parallelBatches: 2,         // Batch paralleli
            delayBetweenBatches: 3000,  // Delay tra batch (ms)
        }
    },
    
    // Prompt engineering per Vision
    prompts: {
        // Prompt base per analisi pagina
        baseAnalysis: {
            focus: [
                'visual_elements',      // Elementi visuali
                'tables',               // Tabelle
                'diagrams',             // Diagrammi
                'formulas',             // Formule
                'code_blocks',          // Blocchi di codice
                'relationships'         // Relazioni tra elementi
            ],
            
            extractionDetail: 'high',  // low|medium|high
            
            outputFormat: 'structured_json',
            
            contextWindow: 500,         // Caratteri di contesto da OCR base
        },
        
        // Prompt specializzati per tipo di contenuto
        specialized: {
            diagram: "Focus su: flusso, componenti, connessioni, labels",
            table: "Estrai: headers, righe, colonne, relazioni, totali",
            code: "Identifica: linguaggio, sintassi, indentazione, commenti",
            formula: "Converti in: LaTeX, variabili, spiegazione",
            chart: "Descrivi: assi, valori, trend, conclusioni"
        }
    },
    
    // Strategia di caching e ottimizzazione
    optimization: {
        // Cache risultati Vision
        caching: {
            enabled: true,
            cacheDir: './data/processed-v4/vision-cache/',
            ttl: 7 * 24 * 60 * 60 * 1000, // 7 giorni
            
            // Genera hash per detectare pagine già processate
            generateHash: (pageContent) => {
                const crypto = require('crypto');
                return crypto.createHash('md5')
                    .update(pageContent.text.substring(0, 1000))
                    .digest('hex');
            }
        },
        
        // Fallback strategies
        fallback: {
            useOCR: true,               // Usa Tesseract se Vision fallisce
            useRegex: true,             // Usa pattern matching come backup
            useHeuristics: true,        // Usa euristiche per inferenza
        },
        
        // Quality control
        qualityControl: {
            minConfidence: 0.7,         // Confidenza minima per accettare risultato
            validateJSON: true,         // Valida output JSON
            crossCheckWithOCR: true,    // Confronta con OCR base
        }
    },
    
    // Metriche e reporting
    metrics: {
        track: [
            'pages_analyzed',
            'vision_calls',
            'total_cost',
            'elements_extracted',
            'processing_time',
            'cache_hits',
            'errors'
        ],
        
        reportPath: './data/processed-v4/vision-report.json',
        
        costEstimation: {
            visionAPIcost: 0.01,        // $ per immagine
            embeddingCost: 0.0001,      // $ per 1k tokens
            gpt4Cost: 0.03,             // $ per 1k tokens
        }
    }
};

// Funzione helper per decidere se analizzare una pagina con Vision
export function shouldAnalyzeWithVision(pageContent, pageNumber, totalPages) {
    const config = VISION_CONFIG.pageSelection;
    
    // Controlla limiti di budget
    if (pageNumber > config.limits.maxPagesPerDocument) {
        return false;
    }
    
    // Prime/ultime pagine
    if (pageNumber <= config.alwaysAnalyze.firstPages || 
        pageNumber > totalPages - config.alwaysAnalyze.lastPages) {
        return true;
    }
    
    // Pattern specifici
    for (const pattern of config.alwaysAnalyze.patterns) {
        if (pageContent.text.match(pattern)) {
            return true;
        }
    }
    
    // Criteri condizionali
    const textLength = pageContent.text.length;
    const hasSpecialChars = /[┌─┐│└┘├┤┬┴┼╔═╗║╚╝╠╣╦╩╬]/.test(pageContent.text);
    const hasMath = /[∑∫∂∇×÷±√∞∈∉⊂⊃∪∩]/.test(pageContent.text);
    const hasCode = /\b(function|class|def|import|var|let|const|if|for|while)\b/.test(pageContent.text);
    
    if (textLength < config.conditionalAnalyze.minTextLength) return true;
    if (hasSpecialChars && config.conditionalAnalyze.hasSpecialChars) return true;
    if (hasMath && config.conditionalAnalyze.hasMathSymbols) return true;
    if (hasCode && config.conditionalAnalyze.hasCodeBlocks) return true;
    
    // Densità del testo (euristica)
    const nonWhitespaceLength = pageContent.text.replace(/\s/g, '').length;
    const density = nonWhitespaceLength / (pageContent.text.length || 1);
    if (density < config.conditionalAnalyze.maxTextDensity) return true;
    
    return false;
}

// Funzione per stimare costi
export function estimateCosts(numPages) {
    const config = VISION_CONFIG;
    const visionPages = Math.min(numPages * 0.3, config.pageSelection.limits.maxPagesPerDocument);
    
    const costs = {
        visionAPI: visionPages * config.metrics.costEstimation.visionAPIcost,
        embeddings: numPages * 0.5 * config.metrics.costEstimation.embeddingCost,
        gpt4Analysis: numPages * 2 * config.metrics.costEstimation.gpt4Cost,
        total: 0
    };
    
    costs.total = costs.visionAPI + costs.embeddings + costs.gpt4Analysis;
    
    return {
        ...costs,
        pagesWithVision: Math.round(visionPages),
        totalPages: numPages,
        withinBudget: costs.total <= config.pageSelection.limits.maxBudget
    };
}

// Report generator
export async function generateVisionReport(results) {
    const report = {
        timestamp: new Date().toISOString(),
        summary: {
            totalPages: results.length,
            pagesAnalyzedWithVision: results.filter(r => r.visionAnalyzed).length,
            elementsExtracted: {
                diagrams: 0,
                tables: 0,
                formulas: 0,
                codeBlocks: 0
            },
            estimatedCost: 0,
            processingTime: 0,
            accuracy: 0
        },
        details: [],
        improvements: []
    };
    
    // Analizza risultati
    for (const result of results) {
        if (result.visionData) {
            report.summary.elementsExtracted.diagrams += result.visionData.visualElements?.filter(e => e.type === 'diagram').length || 0;
            report.summary.elementsExtracted.tables += result.visionData.tables?.length || 0;
            report.summary.elementsExtracted.formulas += result.visionData.formulas?.length || 0;
            report.summary.elementsExtracted.codeBlocks += result.visionData.code?.length || 0;
        }
        
        report.details.push({
            page: result.pageNumber,
            visionUsed: result.visionAnalyzed,
            elementsFound: result.visionData?.visualElements?.length || 0,
            confidence: result.confidence || 0
        });
    }
    
    // Calcola costo
    report.summary.estimatedCost = report.summary.pagesAnalyzedWithVision * VISION_CONFIG.metrics.costEstimation.visionAPIcost;
    
    // Suggerimenti per miglioramenti
    if (report.summary.pagesAnalyzedWithVision === 0) {
        report.improvements.push("Nessuna pagina analizzata con Vision - verificare configurazione");
    }
    
    if (report.summary.elementsExtracted.diagrams === 0 && report.summary.elementsExtracted.tables === 0) {
        report.improvements.push("Pochi elementi visuali trovati - considerare OCR enhancement");
    }
    
    return report;
}

export default VISION_CONFIG;