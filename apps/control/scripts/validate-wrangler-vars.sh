#!/usr/bin/env bash
# validate-wrangler-vars.sh
# Checks that shared vars are consistent across all wrangler*.toml files.
# Shared keys: ADMIN_DOMAIN, TENANT_BASE_DOMAIN,
#              WFP_DISPATCH_NAMESPACE, CF_ACCOUNT_ID
#
# Usage: bash scripts/validate-wrangler-vars.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SHARED_KEYS=(
  ADMIN_DOMAIN
  TENANT_BASE_DOMAIN
  WFP_DISPATCH_NAMESPACE
  CF_ACCOUNT_ID
)

TOML_FILES=()
while IFS= read -r f; do
  TOML_FILES+=("$f")
done < <(find "$PROJECT_DIR" -maxdepth 1 -name 'wrangler*.toml' | sort)

if [ ${#TOML_FILES[@]} -eq 0 ]; then
  echo "ERROR: No wrangler*.toml files found in $PROJECT_DIR"
  exit 1
fi

errors=0

# extract_var FILE SECTION KEY
# Extracts the value of KEY from a given TOML section ("vars" or "env.staging.vars").
# Returns empty string if not found.
extract_var() {
  local file="$1"
  local section="$2"
  local key="$3"

  local in_section=0
  local value=""

  while IFS= read -r line; do
    # Detect section headers
    if [[ "$line" =~ ^\[([a-zA-Z0-9._]+)\] ]]; then
      local current_section="${BASH_REMATCH[1]}"
      if [ "$current_section" = "$section" ]; then
        in_section=1
      else
        # Exiting our target section
        if [ "$in_section" -eq 1 ]; then
          break
        fi
      fi
      continue
    fi

    # Detect array-of-tables headers like [[...]] — exit section
    if [[ "$line" =~ ^\[\[ ]] && [ "$in_section" -eq 1 ]; then
      break
    fi

    if [ "$in_section" -eq 1 ]; then
      # Match KEY = "VALUE" or KEY = 'VALUE' or KEY = VALUE
      if [[ "$line" =~ ^[[:space:]]*${key}[[:space:]]*=[[:space:]]*\"([^\"]*)\" ]]; then
        value="${BASH_REMATCH[1]}"
      elif [[ "$line" =~ ^[[:space:]]*${key}[[:space:]]*=[[:space:]]*\'([^\']*)\' ]]; then
        value="${BASH_REMATCH[1]}"
      elif [[ "$line" =~ ^[[:space:]]*${key}[[:space:]]*=[[:space:]]*([^[:space:]#]+) ]]; then
        value="${BASH_REMATCH[1]}"
      fi
    fi
  done < "$file"

  echo "$value"
}

echo "Validating shared vars across wrangler*.toml files..."
echo "Project directory: $PROJECT_DIR"
echo ""

for section in "vars" "env.staging.vars"; do
  if [ "$section" = "vars" ]; then
    echo "=== Production [vars] ==="
  else
    echo "=== Staging [env.staging.vars] ==="
  fi

  for key in "${SHARED_KEYS[@]}"; do
    # Collect values from all files that define this key in this section
    declare -A seen_values=()
    declare -a files_with_key=()

    for toml in "${TOML_FILES[@]}"; do
      val="$(extract_var "$toml" "$section" "$key")"
      if [ -n "$val" ]; then
        basename="$(basename "$toml")"
        files_with_key+=("$basename")
        seen_values["$basename"]="$val"
      fi
    done

    if [ ${#files_with_key[@]} -le 1 ]; then
      # Only one or zero files define this key — nothing to compare
      unset seen_values
      unset files_with_key
      continue
    fi

    # Check consistency
    reference_file="${files_with_key[0]}"
    reference_val="${seen_values[$reference_file]}"
    inconsistent=0

    for fname in "${files_with_key[@]}"; do
      if [ "${seen_values[$fname]}" != "$reference_val" ]; then
        inconsistent=1
        break
      fi
    done

    if [ "$inconsistent" -eq 1 ]; then
      echo "  MISMATCH: $key"
      for fname in "${files_with_key[@]}"; do
        echo "    $fname: ${seen_values[$fname]}"
      done
      errors=$((errors + 1))
    else
      echo "  OK: $key = $reference_val (${#files_with_key[@]} files)"
    fi

    unset seen_values
    unset files_with_key
  done
  echo ""
done

if [ "$errors" -gt 0 ]; then
  echo "FAIL: $errors inconsistency(ies) found."
  exit 1
else
  echo "PASS: All shared vars are consistent."
  exit 0
fi
