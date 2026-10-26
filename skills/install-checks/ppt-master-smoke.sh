#!/usr/bin/env bash
set -euo pipefail

python_bin="${1:?python executable is required}"
skill_root="${2:?skill root is required}"

tmp_dir="$(mktemp -d /tmp/operator-ppt-master-install.XXXXXX)"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

init_output="$("${python_bin}" "${skill_root}/scripts/project_manager.py" init smoke --format ppt169 --dir "${tmp_dir}")"
project_path="$(printf '%s\n' "${init_output}" | awk -F': ' '/Project created/{print $2}')"

if [[ -z "${project_path}" || ! -d "${project_path}" ]]; then
  echo "ppt-master smoke failed: project was not created" >&2
  exit 1
fi

cat > "${project_path}/svg_output/01_cover.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
  <rect width="1600" height="900" fill="#f8fafc"/>
  <rect x="120" y="120" width="1360" height="660" rx="28" fill="#ffffff" stroke="#1f2937" stroke-width="4"/>
  <text x="160" y="260" font-family="Arial, Microsoft YaHei" font-size="72" font-weight="700" fill="#111827">PPT Master Install Smoke</text>
  <text x="160" y="380" font-family="Arial, Microsoft YaHei" font-size="44" fill="#374151">Editable SVG to PPTX export check</text>
</svg>
SVG

printf '# 01_cover\n\nInstall smoke test notes.\n' > "${project_path}/notes/01_cover.md"

"${python_bin}" "${skill_root}/scripts/svg_to_pptx.py" "${project_path}" --only native --no-notes

pptx_path="$(find "${project_path}/exports" -maxdepth 1 -type f -name '*.pptx' | head -1)"
if [[ -z "${pptx_path}" || ! -s "${pptx_path}" ]]; then
  echo "ppt-master smoke failed: PPTX export is missing or empty" >&2
  exit 1
fi

echo "ppt-master smoke passed: ${pptx_path}"
