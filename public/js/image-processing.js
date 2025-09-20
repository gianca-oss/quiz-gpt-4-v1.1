// public/js/image-processing.js - Modulo per elaborazione avanzata immagini

class ImageProcessor {
    constructor(options = {}) {
        this.options = {
            maxWidth: options.maxWidth || 1600,
            maxHeight: options.maxHeight || 1600,
            quality: options.quality || 0.9,
            ocrOptimized: options.ocrOptimized || false,
            ...options
        };
    }

    // Processa un singolo file immagine
    async processImageFile(file, processingOptions = {}) {
        const options = { ...this.options, ...processingOptions };
        
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                const img = new Image();
                
                img.onload = () => {
                    try {
                        const processedDataUrl = this.processImage(img, options);
                        resolve({
                            dataUrl: processedDataUrl,
                            originalSize: file.size,
                            processedSize: this.getDataUrlSize(processedDataUrl),
                            dimensions: this.getImageDimensions(img),
                            quality: this.analyzeImageQuality(processedDataUrl)
                        });
                    } catch (error) {
                        reject(error);
                    }
                };
                
                img.onerror = () => reject(new Error('Impossibile caricare l\'immagine'));
                img.src = e.target.result;
            };
            
            reader.onerror = () => reject(new Error('Errore nella lettura del file'));
            reader.readAsDataURL(file);
        });
    }

    // Processa un'immagine esistente
    processImage(img, options = {}) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Calcola dimensioni ottimali
        const { width, height } = this.calculateOptimalDimensions(
            img.width, 
            img.height, 
            options.maxWidth, 
            options.maxHeight
        );

        canvas.width = width;
        canvas.height = height;

        // Sfondo bianco per OCR
        if (options.ocrOptimized) {
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, width, height);
        }

        // Applicazione filtri per migliorare la qualità
        if (options.ocrOptimized) {
            ctx.imageSmoothingEnabled = false; // Preserva il testo
        }

        // Disegna l'immagine
        ctx.drawImage(img, 0, 0, width, height);

        // Applica ottimizzazioni per OCR se richiesto
        if (options.ocrOptimized) {
            this.applyOCROptimizations(ctx, width, height);
        }

        return canvas.toDataURL('image/jpeg', options.quality);
    }

    // Ottimizzazioni specifiche per OCR
    applyOCROptimizations(ctx, width, height) {
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            // Converti in scala di grigi per analisi
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            
            // Migliora contrasto
            const contrast = 1.2;
            const brightness = 10;
            
            data[i] = Math.min(255, Math.max(0, (data[i] - 128) * contrast + 128 + brightness));     // Red
            data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - 128) * contrast + 128 + brightness)); // Green  
            data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - 128) * contrast + 128 + brightness)); // Blue
        }

        // Applica le modifiche
        ctx.putImageData(imageData, 0, 0);
    }

    // Calcola dimensioni ottimali mantenendo aspect ratio
    calculateOptimalDimensions(originalWidth, originalHeight, maxWidth, maxHeight) {
        const aspectRatio = originalWidth / originalHeight;
        let newWidth = originalWidth;
        let newHeight = originalHeight;

        // Ridimensiona solo se necessario
        if (originalWidth > maxWidth || originalHeight > maxHeight) {
            if (aspectRatio > 1) {
                // Landscape
                newWidth = Math.min(originalWidth, maxWidth);
                newHeight = newWidth / aspectRatio;
            } else {
                // Portrait
                newHeight = Math.min(originalHeight, maxHeight);
                newWidth = newHeight * aspectRatio;
            }
        }

        return {
            width: Math.round(newWidth),
            height: Math.round(newHeight)
        };
    }

    // Analizza qualità dell'immagine
    analyzeImageQuality(dataUrl) {
        const sizeKB = this.getDataUrlSize(dataUrl) / 1024;
        
        if (sizeKB > 400) return 'high';
        if (sizeKB > 150) return 'medium';
        return 'low';
    }

    // Ottieni dimensioni immagine
    getImageDimensions(img) {
        return {
            width: img.naturalWidth || img.width,
            height: img.naturalHeight || img.height
        };
    }

    // Calcola size del dataUrl
    getDataUrlSize(dataUrl) {
        return Math.round((dataUrl.length - 22) * 0.75); // Rimuove header base64
    }

    // Elaborazione batch
    async processBatch(files, progressCallback) {
        const results = [];
        
        for (let i = 0; i < files.length; i++) {
            try {
                if (progressCallback) {
                    progressCallback(i, files.length, files[i].name);
                }
                
                const processed = await this.processImageFile(files[i], {
                    ocrOptimized: true,
                    quality: 0.95
                });
                
                results.push({
                    file: files[i],
                    processed,
                    success: true
                });
                
            } catch (error) {
                results.push({
                    file: files[i],
                    error: error.message,
                    success: false
                });
            }
        }
        
        return results;
    }

    // Validazione file
    isValidImageFile(file) {
        const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        const maxSize = 10 * 1024 * 1024; // 10MB
        
        if (!validTypes.includes(file.type)) {
            return { valid: false, reason: 'Tipo file non supportato' };
        }
        
        if (file.size > maxSize) {
            return { valid: false, reason: 'File troppo grande (max 10MB)' };
        }
        
        return { valid: true };
    }

    // Formato file size
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    // Rileva bordi documento (implementazione base)
    detectDocumentEdges(canvas) {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Implementazione semplificata di edge detection
        // In una versione completa useresti algoritmi come Canny edge detection
        
        const edges = [];
        const threshold = 50;
        
        for (let y = 1; y < canvas.height - 1; y++) {
            for (let x = 1; x < canvas.width - 1; x++) {
                const idx = (y * canvas.width + x) * 4;
                
                // Calcola gradiente
                const gx = -data[idx - 4] + data[idx + 4];
                const gy = -data[(idx - canvas.width * 4)] + data[(idx + canvas.width * 4)];
                const magnitude = Math.sqrt(gx * gx + gy * gy);
                
                if (magnitude > threshold) {
                    edges.push({ x, y, magnitude });
                }
            }
        }
        
        return edges;
    }

    // Correggi prospettiva (implementazione base)
    correctPerspective(canvas, corners) {
        // Questa è una versione semplificata
        // Una implementazione completa richiederebbe una trasformazione prospettica
        const ctx = canvas.getContext('2d');
        
        // Per ora applica solo una rotazione se necessario
        const angle = this.calculateRotationAngle(corners);
        
        if (Math.abs(angle) > 2) { // Solo se rotazione significativa
            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;
            
            ctx.translate(centerX, centerY);
            ctx.rotate(angle * Math.PI / 180);
            ctx.translate(-centerX, -centerY);
        }
        
        return canvas;
    }

    // Calcola angolo di rotazione
    calculateRotationAngle(corners) {
        if (!corners || corners.length < 4) return 0;
        
        // Semplificazione: usa i primi due punti per calcolare l'angolo
        const dx = corners[1].x - corners[0].x;
        const dy = corners[1].y - corners[0].y;
        
        return Math.atan2(dy, dx) * 180 / Math.PI;
    }
}

// Camera Controller
class CameraController {
    constructor() {
        this.stream = null;
        this.videoElement = null;
        this.isActive = false;
    }

    async initialize(videoElement, constraints = {}) {
        this.videoElement = videoElement;
        
        const defaultConstraints = {
            video: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                focusMode: 'continuous',
                ...constraints.video
            }
        };

        try {
            this.stream = await navigator.mediaDevices.getUserMedia(defaultConstraints);
            this.videoElement.srcObject = this.stream;
            this.isActive = true;
            
            return { success: true };
        } catch (error) {
            return { 
                success: false, 
                error: this.getCameraErrorMessage(error) 
            };
        }
    }

    captureFrame(quality = 0.9) {
        if (!this.isActive || !this.videoElement) {
            throw new Error('Camera non attiva');
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = this.videoElement.videoWidth;
        canvas.height = this.videoElement.videoHeight;
        
        ctx.drawImage(this.videoElement, 0, 0);
        
        return {
            dataUrl: canvas.toDataURL('image/jpeg', quality),
            dimensions: {
                width: canvas.width,
                height: canvas.height
            }
        };
    }

    stop() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        
        if (this.videoElement) {
            this.videoElement.srcObject = null;
        }
        
        this.isActive = false;
    }

    getCameraErrorMessage(error) {
        switch (error.name) {
            case 'NotAllowedError':
                return 'Permesso camera negato. Verifica le impostazioni del browser.';
            case 'NotFoundError':
                return 'Nessuna camera trovata sul dispositivo.';
            case 'NotReadableError':
                return 'Camera in uso da un\'altra applicazione.';
            case 'OverconstrainedError':
                return 'Configurazione camera non supportata.';
            default:
                return 'Errore nell\'accesso alla camera: ' + error.message;
        }
    }

    // Rileva stabilità per auto-capture
    async detectStability(threshold = 0.1, duration = 2000) {
        return new Promise((resolve) => {
            const frames = [];
            const interval = 100; // Check ogni 100ms
            let startTime = Date.now();
            
            const checkStability = () => {
                if (!this.isActive) {
                    resolve(false);
                    return;
                }
                
                const frame = this.captureFrame(0.3); // Bassa qualità per speed
                frames.push(frame.dataUrl);
                
                if (frames.length > 3) {
                    frames.shift(); // Mantieni solo ultimi 3 frames
                    
                    // Calcola differenza tra frames (implementazione semplificata)
                    const similarity = this.calculateFrameSimilarity(frames);
                    
                    if (similarity > (1 - threshold)) {
                        if (Date.now() - startTime > duration) {
                            resolve(true);
                            return;
                        }
                    } else {
                        startTime = Date.now(); // Reset timer
                    }
                }
                
                setTimeout(checkStability, interval);
            };
            
            checkStability();
        });
    }

    calculateFrameSimilarity(frames) {
        // Implementazione semplificata - confronta size dei dataUrl
        if (frames.length < 2) return 0;
        
        const sizes = frames.map(f => f.length);
        const avgSize = sizes.reduce((a, b) => a + b) / sizes.length;
        const variance = sizes.reduce((sum, size) => sum + Math.pow(size - avgSize, 2), 0) / sizes.length;
        
        return 1 - (variance / (avgSize * avgSize)); // Normalized similarity
    }
}

// Export per uso globale
if (typeof window !== 'undefined') {
    window.ImageProcessor = ImageProcessor;
    window.CameraController = CameraController;
}

// Export per Node.js se necessario
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ImageProcessor, CameraController };
}