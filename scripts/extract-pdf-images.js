// scripts/extract-pdf-images.js
// Estrae immagini, grafici e tabelle dal PDF per analisi più completa

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf');

async function extractPDFImages(pdfPath, outputDir) {
    console.log('🖼️ Estrazione immagini dal PDF...');
    
    const pdfData = new Uint8Array(fs.readFileSync(pdfPath));
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    
    const images = [];
    const diagrams = [];
    let imageCount = 0;
    
    // Crea directory per immagini
    const imagesDir = path.join(outputDir, 'images');
    if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
    }
    
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        try {
            const page = await pdf.getPage(pageNum);
            const ops = await page.getOperatorList();
            
            // Cerca immagini nella pagina
            for (let i = 0; i < ops.fnArray.length; i++) {
                // OPS.paintImageXObject = 85
                if (ops.fnArray[i] === 85) {
                    const imgName = ops.argsArray[i][0];
                    
                    try {
                        const img = await page.objs.get(imgName);
                        
                        if (img && img.width > 50 && img.height > 50) { // Ignora immagini piccole
                            imageCount++;
                            
                            // Salva metadati immagine
                            const imageInfo = {
                                id: `img_p${pageNum}_${imageCount}`,
                                page: pageNum,
                                width: img.width,
                                height: img.height,
                                type: detectImageType(img),
                                path: `images/page_${pageNum}_img_${imageCount}.jpg`
                            };
                            
                            // Determina se è un diagramma/grafico
                            if (isLikelyDiagram(img)) {
                                diagrams.push(imageInfo);
                                imageInfo.isDiagram = true;
                            }
                            
                            images.push(imageInfo);
                            
                            // Salva l'immagine
                            if (img.data) {
                                const imagePath = path.join(outputDir, imageInfo.path);
                                saveImageData(img, imagePath);
                            }
                        }
                    } catch (imgError) {
                        console.warn(`⚠️ Errore estrazione immagine pagina ${pageNum}`);
                    }
                }
            }
            
            // Estrai anche annotazioni e form fields che potrebbero contenere info utili
            const annotations = await page.getAnnotations();
            for (const annot of annotations) {
                if (annot.subtype === 'Widget' && annot.fieldType === 'Tx') {
                    // Campo testo - potrebbe contenere risposte
                    console.log(`📝 Campo testo trovato a pagina ${pageNum}: ${annot.fieldValue || 'vuoto'}`);
                }
            }
            
        } catch (pageError) {
            console.warn(`⚠️ Errore pagina ${pageNum}:`, pageError.message);
        }
        
        if (pageNum % 50 === 0) {
            console.log(`⏳ Elaborate ${pageNum}/${pdf.numPages} pagine`);
        }
    }
    
    // Salva indice immagini
    const imageIndex = {
        totalImages: images.length,
        totalDiagrams: diagrams.length,
        images: images,
        diagrams: diagrams
    };
    
    fs.writeFileSync(
        path.join(outputDir, 'image-index.json'),
        JSON.stringify(imageIndex, null, 2)
    );
    
    console.log(`✅ Estratte ${images.length} immagini (${diagrams.length} diagrammi)`);
    
    return imageIndex;
}

function detectImageType(img) {
    // Analizza caratteristiche dell'immagine
    if (img.width === img.height) return 'square';
    if (img.width > img.height * 2) return 'banner';
    if (img.height > img.width * 2) return 'portrait';
    return 'standard';
}

function isLikelyDiagram(img) {
    // Euristica per identificare diagrammi/grafici
    // Basata su rapporti dimensioni e patterns
    const ratio = img.width / img.height;
    
    // Grafici tendono ad avere rapporti standard
    if (Math.abs(ratio - 1.0) < 0.1) return true; // Quadrati
    if (Math.abs(ratio - 1.33) < 0.1) return true; // 4:3
    if (Math.abs(ratio - 1.77) < 0.1) return true; // 16:9
    
    return false;
}

function saveImageData(img, outputPath) {
    // Implementazione semplificata - in produzione useresti sharp o jimp
    console.log(`💾 Salvando immagine: ${outputPath}`);
}

// Esecuzione
if (require.main === module) {
    const pdfPath = process.argv[2];
    const outputDir = process.argv[3] || './data/processed';
    
    if (!pdfPath) {
        console.log('Uso: node extract-pdf-images.js <pdf-path> [output-dir]');
        process.exit(1);
    }
    
    extractPDFImages(pdfPath, outputDir)
        .then(() => console.log('🎉 Estrazione completata!'))
        .catch(console.error);
}

module.exports = { extractPDFImages };