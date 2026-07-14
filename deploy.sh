#!/usr/bin/env bash
# Despliegue de RS_CORE_TechSpecValidation (Nivel 3) en Azure Static Web Apps.
# Idempotente: re-ejecutar no duplica recursos. Requiere rol Owner/Contributor sobre la suscripción o el RG.
set -euo pipefail

SUB="${SUB:-e4f96f57-d13b-4b72-ac70-f6bd4d31994d}"   # TechSolutions Projects AI
RG="${RG:-rg-techspec}"
LOC="${LOC:-westeurope}"
STORAGE="${STORAGE:-rstechspecdata}"                  # 3-24 minúsculas/números, único global
SWA="${SWA:-rs-techspec-validation}"
REPO="${REPO:-https://github.com/RocaSalvatellaAi/RS_CORE_TechSpecValidation}"

log(){ printf '\033[0;32m[deploy]\033[0m %s\n' "$*"; }

log "Suscripción $SUB / RG $RG / $LOC"
az account set --subscription "$SUB"

log "Proveedores"
az provider register -n Microsoft.Web --wait
az provider register -n Microsoft.Storage --wait

log "Resource group"
az group create -n "$RG" -l "$LOC" -o none

log "Cuenta de almacenamiento (respuestas)"
az storage account create -n "$STORAGE" -g "$RG" -l "$LOC" --sku Standard_LRS --allow-blob-public-access false -o none
CS=$(az storage account show-connection-string -n "$STORAGE" -g "$RG" -o tsv)

log "Static Web App (con API integrada + workflow de GitHub Actions)"
az staticwebapp create -n "$SWA" -g "$RG" \
  --source "$REPO" --branch main \
  --app-location "/" --api-location "api" \
  --location "$LOC" --sku Free \
  --token "$(gh auth token)" -o none

log "Conectar API con el almacén"
az staticwebapp appsettings set -n "$SWA" --setting-names STORAGE_CONNECTION_STRING="$CS" -o none

URL=$(az staticwebapp show -n "$SWA" -g "$RG" --query defaultHostname -o tsv)
log "Listo → https://$URL"
log "Cuestionario:  https://$URL/?c=<cliente>"
log "Panel:         https://$URL/admin   (requiere rol 'rs': az staticwebapp users invite ...)"
