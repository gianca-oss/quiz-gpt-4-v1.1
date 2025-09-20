import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

// Configura il worker per Node.js
if (typeof window === 'undefined') {
    // Ambiente Node.js
    pdfjsLib.GlobalWorkerOptions.workerSrc = 
        'pdfjs-dist/legacy/build/pdf.worker.js';
}

export default pdfjsLib;