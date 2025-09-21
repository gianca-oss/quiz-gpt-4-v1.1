// test-pdf-extraction.js (mettilo nella ROOT del progetto, non in scripts/)
import pdfParse from 'pdf-parse-fork';
import fs from 'fs/promises';
import path from 'path';

async function test() {
    console.log('Test estrazione PDF...\n');
    
    // Path corretto dalla root
    const pdfPath = path.join('./data/source/corso_completo.pdf');
    console.log('Cercando:', path.resolve(pdfPath));
    
    const pdfBuffer = await fs.readFile(pdfPath);
    console.log('PDF letto, dimensione:', pdfBuffer.length, 'bytes\n');
    
    console.log('Parsing (ignora warning TT)...\n');
    const pdfData = await pdfParse(pdfBuffer);
    
    console.log('\n✅ RISULTATI:');
    console.log('Pagine:', pdfData.numpages);
    console.log('Testo estratto:', pdfData.text.length, 'caratteri');
    console.log('Prime 500 caratteri:', pdfData.text.substring(0, 500));
}

test().catch(console.error);