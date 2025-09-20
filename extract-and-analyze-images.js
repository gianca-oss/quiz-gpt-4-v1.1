// extract-and-analyze-images.js - Estrae e analizza immagini dal PDF

const fs = require('fs').promises;
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp'); // Per processare immagini
const Anthropic = require('@anthropic-ai/sdk');

// Configurazione
const INPUT_PDF = './data/source/corso_completo.pdf';
const OUTPUT_DIR = './data/images';
const DESCRIPTIONS_FILE = './data/image-descriptions.json';

// Inizializza Anthropic
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Estrae tutte le immagini dal PDF
 */
async function extractImagesFromPDF() {
    console.log('📖 Caricamento PDF...');
    const pdfBytes = await fs.readFile(INPUT_PDF);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    
    const images = [];
    const pages = pdfDoc.getPages();
    
    console.log(`📄 Analisi di ${pages.length} pagine...`);
    
    // Crea directory output se non esiste
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
    
    for (let pageNum = 0; pageNum < pages.length; pageNum++) {
        const page = pages[pageNum];
        
        try {
            // Ottieni risorse della pagina
            const xObjectDict = page.node.Resources()?.XObject();
            if (!xObjectDict) continue;
            
            const xObjectKeys = xObjectDict.keys();
            
            for (const key of xObjectKeys) {
                const xObject = xObjectDict.get(key);
                
                // Verifica se è un'immagine
                if (xObject && xObject.get('Subtype')?.name === 'Image') {
                    const width = xObject.get('Width').value;
                    const height = xObject.get('Height').value;
                    
                    // Salta immagini troppo piccole (probabilmente decorative)
                    if (width < 100 || height < 100) continue;
                    
                    console.log(`  🖼️ Trovata immagine a pagina ${pageNum + 1} (${width}x${height})`);
                    
                    // Estrai i dati dell'immagine
                    const imageData = xObject.get('Data');
                    if (imageData) {
                        const imagePath = path.join(OUTPUT_DIR, `page_${pageNum + 1}_img_${key}.png`);
                        
                        // Salva l'immagine
                        await fs.writeFile(imagePath, imageData);
                        
                        images.push({
                            page: pageNum + 1,
                            path: imagePath,
                            width,
                            height,
                            key
                        });
                    }
                }
            }
        } catch (error) {
            console.log(`  ⚠️ Errore estrazione immagini pagina ${pageNum + 1}:`, error.message);
        }
    }
    
    console.log(`✅ Estratte ${images.length} immagini significative`);
    return images;
}

/**
 * Analizza un'immagine con Claude
 */
async function analyzeImageWithClaude(imagePath, pageNum) {
    try {
        // Leggi l'immagine e convertila in base64
        const imageBuffer = await fs.readFile(imagePath);
        const base64Image = imageBuffer.toString('base64');
        
        // Ottimizza dimensione se necessario
        let optimizedBase64 = base64Image;
        if (base64Image.length > 500000) { // Se > 500KB
            console.log('    Ottimizzazione dimensione immagine...');
            const optimized = await sharp(imageBuffer)
                .resize(1200, 1200, { 
                    fit: 'inside',
                    withoutEnlargement: true 
                })
                .jpeg({ quality: 85 })
                .toBuffer();
            optimizedBase64 = optimized.toString('base64');
        }
        
        const prompt = `Analizza questa immagine estratta dalla pagina ${pageNum} di un documento accademico.

Fornisci una descrizione DETTAGLIATA che includa:
1. Tipo di contenuto (grafico, tabella, diagramma, schema, foto, etc.)
2. Contenuto principale e informazioni chiave
3. Testo visibile nell'immagine (titoli, etichette, valori)
4. Relazioni o pattern mostrati
5. Contesto didattico (cosa insegna o dimostra)

Se è una tabella, trascrivi TUTTI i dati.
Se è un grafico, descrivi assi, valori e trend.
Se è un diagramma, spiega tutti i componenti e le relazioni.

IMPORTANTE: Sii il più specifico e dettagliato possibile. Queste descrizioni saranno usate per rispondere a domande d'esame.`;

        const response = await anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 1500,
            temperature: 0,
            messages: [{
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: 'image/jpeg',
                            data: optimizedBase64
                        }
                    },
                    {
                        type: 'text',
                        text: prompt
                    }
                ]
            }]
        });
        
        return response.content[0].text;
        
    } catch (error) {
        console.error(`    ❌ Errore analisi immagine:`, error.message);
        return null;
    }
}

/**
 * Processa tutte le immagini
 */
async function processAllImages() {
    console.log('\n🚀 Avvio estrazione e analisi immagini...\n');
    
    // Estrai immagini
    const images = await extractImagesFromPDF();
    
    if (images.length === 0) {
        console.log('Nessuna immagine trovata nel PDF');
        return;
    }
    
    // Analizza ogni immagine
    const descriptions = [];
    
    for (let i = 0; i < images.length; i++) {
        const image = images[i];
        console.log(`\n📸 Analisi immagine ${i + 1}/${images.length} (pagina ${image.page})...`);
        
        const description = await analyzeImageWithClaude(image.path, image.page);
        
        if (description) {
            descriptions.push({
                page: image.page,
                imagePath: image.path,
                width: image.width,
                height: image.height,
                description: description,
                timestamp: new Date().toISOString()
            });
            
            console.log(`  ✅ Analisi completata`);
            console.log(`  📝 Anteprima: ${description.substring(0, 150)}...`);
        }
        
        // Pausa per evitare rate limiting
        if (i < images.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    // Salva descrizioni
    await fs.writeFile(
        DESCRIPTIONS_FILE,
        JSON.stringify(descriptions, null, 2)
    );
    
    console.log(`\n✅ Completato! ${descriptions.length} immagini analizzate`);
    console.log(`📁 Descrizioni salvate in: ${DESCRIPTIONS_FILE}`);
    
    // Statistiche
    const stats = {
        totalImages: images.length,
        analyzedImages: descriptions.length,
        failedImages: images.length - descriptions.length,
        pagesWithImages: [...new Set(images.map(i => i.page))].length
    };
    
    console.log('\n📊 Statistiche:');
    console.log(`  - Immagini totali: ${stats.totalImages}`);
    console.log(`  - Immagini analizzate: ${stats.analyzedImages}`);
    console.log(`  - Analisi fallite: ${stats.failedImages}`);
    console.log(`  - Pagine con immagini: ${stats.pagesWithImages}`);
}

// Esegui
if (require.main === module) {
    processAllImages().catch(console.error);
}

module.exports = { extractImagesFromPDF, analyzeImageWithClaude };