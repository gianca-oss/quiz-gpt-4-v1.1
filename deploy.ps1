# deploy.ps1
Write-Host "Iniziando deploy su Vercel..." -ForegroundColor Cyan

# Aggiungi tutti i file
git add .

# Richiedi messaggio di commit
$commitMessage = Read-Host "Inserisci messaggio di commit"

# Commit
git commit -m $commitMessage

# Push a GitHub (triggera deploy automatico)
Write-Host "Push su GitHub..." -ForegroundColor Yellow
git push origin main

# Opzionale: Deploy diretto su Vercel
Write-Host "Deploy diretto su Vercel..." -ForegroundColor Green
vercel --prod

Write-Host "Deploy completato!" -ForegroundColor Green