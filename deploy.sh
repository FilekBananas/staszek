#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${CLOUDSDK_CONFIG:-}" ]]; then
  mkdir -p "${CLOUDSDK_CONFIG}"
elif [[ ! -w "${HOME}/.config" ]]; then
  export CLOUDSDK_CONFIG="$(pwd)/.gcloud"
  mkdir -p "${CLOUDSDK_CONFIG}"
fi

trim_ws() {
  local s="${1:-}"
  s="${s#"${s%%[!$' \t\r\n']*}"}"
  s="${s%"${s##*[!$' \t\r\n']}"}"
  printf "%s" "${s}"
}

load_dotenv() {
  local file="${1:-.env}"
  if [[ ! -f "${file}" ]]; then
    return 0
  fi

  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="$(trim_ws "${line}")"
    [[ -z "${line}" ]] && continue
    [[ "${line}" == \#* ]] && continue

    if [[ "${line}" == export\ * ]]; then
      line="$(trim_ws "${line#export }")"
    fi

    if [[ "${line}" =~ ^([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local value="${BASH_REMATCH[2]}"

      value="$(trim_ws "${value}")"

      # Strip inline comments " # comment" only when value is not quoted.
      if [[ ! "${value}" =~ ^\".*\"$ && ! "${value}" =~ ^\'.*\'$ ]]; then
        value="${value%% \#*}"
        value="$(trim_ws "${value}")"
      fi

      # Unquote simple "..." / '...'
      if [[ "${value}" =~ ^\"(.*)\"$ ]]; then
        value="${BASH_REMATCH[1]}"
      elif [[ "${value}" =~ ^\'(.*)\'$ ]]; then
        value="${BASH_REMATCH[1]}"
      fi

      export "${key}=${value}"
    fi
  done < "${file}"
}

# Load local .env if present (does not override real env vars).
load_dotenv ".env"

PROJECT_ID="${PROJECT_ID:-staszek-487611}"
REGION="$(trim_ws "${REGION:-europe-west1}")"
if [[ -z "${REGION}" ]]; then
  REGION="europe-west1"
fi
SERVICE_NAME="${SERVICE_NAME:-staszek2}"
AR_REPO="${AR_REPO:-staszek2}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"
MAX_INSTANCES="${MAX_INSTANCES:-10}"
CONCURRENCY="${CONCURRENCY:-8}"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_EMAIL:-}"
BUILD_METHOD="${BUILD_METHOD:-cloudbuild}" # cloudbuild|local
SKIP_BUILD="${SKIP_BUILD:-0}" # 1 -> deploy existing image

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}:latest"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud not found. Install Google Cloud CLI first."
  exit 1
fi

echo "Project: ${PROJECT_ID}"
echo "Region: ${REGION}"
echo "Service: ${SERVICE_NAME}"
echo "Image: ${IMAGE}"

ACTIVE_ACCOUNT="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n 1 || true)"
if [[ -z "${ACTIVE_ACCOUNT}" ]]; then
  echo "ERROR: no active gcloud account. Run: gcloud auth login"
  exit 1
fi

gcloud config set project "${PROJECT_ID}"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

if ! gcloud artifacts repositories describe "${AR_REPO}" --location "${REGION}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${AR_REPO}" \
    --repository-format docker \
    --location "${REGION}" \
    --description "Docker repo for ${SERVICE_NAME}"
fi

if [[ "${SKIP_BUILD}" != "1" ]]; then
  if [[ "${BUILD_METHOD}" == "cloudbuild" ]]; then
    if [[ ! -f "Dockerfile" ]]; then
      echo "ERROR: Dockerfile not found in $(pwd)."
      echo "Cloud Build requires a Dockerfile when using: gcloud builds submit --tag ..."
      echo
      echo "Fix options:"
      echo "1) Add a Dockerfile to this directory, then retry."
      echo "2) Run this script from a directory that contains a Dockerfile."
      echo "3) Deploy an existing image: SKIP_BUILD=1 ./deploy.sh"
      exit 1
    fi
    if ! gcloud builds submit --tag "${IMAGE}" .; then
      echo "ERROR: Cloud Build failed."
      echo "If you see PERMISSION_DENIED, grant your user role: roles/cloudbuild.builds.editor"
      echo "Or run with local Docker build: BUILD_METHOD=local ./deploy.sh"
      exit 1
    fi
  elif [[ "${BUILD_METHOD}" == "local" ]]; then
    if ! command -v docker >/dev/null 2>&1; then
      echo "ERROR: docker not found. Install Docker Desktop or use BUILD_METHOD=cloudbuild."
      exit 1
    fi
    if ! docker info >/dev/null 2>&1; then
      echo "ERROR: Docker daemon not running. Start Docker Desktop and try again."
      exit 1
    fi

    gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
    docker build -t "${IMAGE}" .
    docker push "${IMAGE}"
  else
    echo "ERROR: invalid BUILD_METHOD='${BUILD_METHOD}'. Use 'cloudbuild' or 'local'."
    exit 1
  fi
else
  echo "Skipping build/push (SKIP_BUILD=1)."
fi

escape_env_value() {
  local v="${1:-}"
  # gcloud --set-env-vars uses comma-separated values; escape commas/backslashes
  v="${v//\\/\\\\}"
  v="${v//,/\\,}"
  v="${v//$'\n'/}"
  printf "%s" "${v}"
}

required_missing=()
for k in LICZNIK_API_KEY ADMIN_PASSWORD ADMIN_TOKEN_SECRET; do
  if [[ -z "${!k-}" ]]; then
    required_missing+=("${k}")
  fi
done
if (( ${#required_missing[@]} )); then
  echo "ERROR: Missing required env vars: ${required_missing[*]}"
  echo "Add them to .env (KEY=value) or export them, then retry."
  exit 1
fi

# Optional but recommended for forum/comment moderation.
if [[ -z "${TOGETHER_API_KEY:-}" ]]; then
  echo "WARN: TOGETHER_API_KEY is not set. Adding forum entries will be rejected."
fi

if [[ -z "${DEPLOYED_AT:-}" ]]; then
  DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi

if [[ -z "${GIT_SHA:-}" ]]; then
  if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || true)"
  else
    GIT_SHA=""
  fi
fi

declare -a DEPLOY_ENV_PAIRS
add_env() {
  local k="${1:-}"
  local v="${2-}"
  if [[ -z "${k}" ]]; then return 0; fi
  # Intentionally keep empty values: .env is the single source of truth and should
  # override whatever is currently configured in Cloud Run.
  DEPLOY_ENV_PAIRS+=("${k}=$(escape_env_value "${v}")")
}

add_env "DEPLOYED_AT" "${DEPLOYED_AT:-}"
add_env "GIT_SHA" "${GIT_SHA:-}"
add_env "LICZNIK_BASE_URL" "${LICZNIK_BASE_URL:-}"
add_env "LICZNIK_API_KEY" "${LICZNIK_API_KEY:-}"
add_env "ADMIN_PASSWORD" "${ADMIN_PASSWORD:-}"
add_env "ADMIN_TOKEN_SECRET" "${ADMIN_TOKEN_SECRET:-}"
add_env "ADMIN_TOKEN_TTL_DAYS" "${ADMIN_TOKEN_TTL_DAYS:-}"
add_env "TOGETHER_API_KEY" "${TOGETHER_API_KEY:-}"
add_env "TOGETHER_MODEL" "${TOGETHER_MODEL:-}"
add_env "TOGETHER_BASE_URL" "${TOGETHER_BASE_URL:-}"
add_env "CORS_ORIGINS" "${CORS_ORIGINS:-}"

DEPLOY_ENV_VARS="$(IFS=','; echo "${DEPLOY_ENV_PAIRS[*]}")"

if [[ -n "${SERVICE_ACCOUNT_EMAIL}" ]]; then
  gcloud run deploy "${SERVICE_NAME}" \
    --image "${IMAGE}" \
    --region "${REGION}" \
    --allow-unauthenticated \
    --concurrency "${CONCURRENCY}" \
    --min-instances "${MIN_INSTANCES}" \
    --max-instances "${MAX_INSTANCES}" \
    --set-env-vars "${DEPLOY_ENV_VARS}" \
    --service-account "${SERVICE_ACCOUNT_EMAIL}"
else
  gcloud run deploy "${SERVICE_NAME}" \
    --image "${IMAGE}" \
    --region "${REGION}" \
    --allow-unauthenticated \
    --concurrency "${CONCURRENCY}" \
    --min-instances "${MIN_INSTANCES}" \
    --max-instances "${MAX_INSTANCES}" \
    --set-env-vars "${DEPLOY_ENV_VARS}"
fi
