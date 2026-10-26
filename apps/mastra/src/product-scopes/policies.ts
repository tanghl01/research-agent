import type { OperatorOutputContract } from "./types.js";

export type SkillScopePolicy = {
  outputContract: OperatorOutputContract;
  selectionGuidance: string;
  executionGuidance: string;
};

export const skillScopePolicies: Record<string, SkillScopePolicy> = {
  "gorden-ppt-skill": {
    outputContract: {
      required_output_format: "pptx",
      preferred_artifact_path: "runs/gorden-ppt-skill/output/gorden_deck.pptx",
      required_slide_count_when_requested: true
    },
    selectionGuidance: "Use for editable PowerPoint/PPTX decks, native Office files, and requests that require an editable .pptx.",
    executionGuidance:
      "This selected skill must produce only an editable PPTX deck. Use the upstream GordenPPTSkill instructions, templates, detail.json, and scripts/build_pptx.py. Do not produce HTML in this run. Gorden detail.json stores pages in pages[], template slide numbers in pages[].slide_number, and editable text slots in pages[].text_slots[]. Use slot_id values only from text_slots; do not use nonexistent slides[] or slots[] fields. For a very short requested deck, choose a valid minimal slide set from page_roles such as cover + one content page + ending when suitable. Prefer a compact Python script that writes edits.json programmatically, then run build_pptx.py and stat/sha256sum the PPTX."
  },
  "guizang-ppt-skill": {
    outputContract: {
      required_output_format: "html",
      preferred_artifact_path: "runs/guizang-ppt-skill/output/guizang_deck.html",
      required_slide_count_when_requested: true
    },
    selectionGuidance:
      "Use for web/HTML decks, horizontal browser presentations, Swiss style, magazine style, and single-file HTML output.",
    executionGuidance:
      "This selected skill must produce only an HTML deck. Do not paste a huge finished HTML file into terminal or file_editor. Do not use long shell heredocs for scripts; they are unreliable in this runtime. If you need helper code, create one short script file with file_editor, then run it with terminal. The script should read template-swiss.html, build slides from slide data derived from the user request, write the final HTML atomically, then run stat/sha256sum. Keep the script compact and verify the HTML contains the requested topic and the requested slide count."
  },
  "ppt-master": {
    outputContract: {
      required_output_format: "pptx",
      preferred_artifact_path: "runs/ppt-master/output/ppt_master_deck.pptx",
      required_slide_count_when_requested: true
    },
    selectionGuidance:
      "Use when the user explicitly asks for ppt-master, SVG-first slide generation, SVG-to-PPTX conversion, advanced visual pipelines, or PPT Master templates. For a simple editable PPT smoke test, prefer gorden-ppt-skill.",
    executionGuidance:
      "This selected skill must produce an editable PPTX deck through the upstream ppt-master skill. Read SKILL.md first, then use the documented project workflow and scripts. Create all generated project files inside the provided workspace path. Prefer a compact project and avoid long shell heredocs. Verify the exported PPTX exists, has non-zero size, and contains the requested topic."
  },
  "scientific-agent-skills": {
    outputContract: {
      required_output_format: "research",
      preferred_artifact_path: "runs/scientific-agent-skills/output/research_result.md"
    },
    selectionGuidance:
      "Use for scientific research, literature review, bioinformatics, chemistry, scientific data analysis, and research-tool tasks. This is a collection; inspect the relevant nested SKILL.md before execution.",
    executionGuidance:
      "This selected scope is a scientific skill collection. Inspect README.md and the relevant nested SKILL.md under skills/ before executing. Produce a concise Markdown research artifact with sources, assumptions, commands run, and validation notes. Do not claim scientific or biomedical correctness without evidence and user review."
  },
  "qinyan-academic-skills": {
    outputContract: {
      required_output_format: "research",
      preferred_artifact_path: "runs/qinyan-academic-skills/output/qinyan_research_result.md"
    },
    selectionGuidance:
      "Use for Chinese/English academic paper search, Qinyan OpenAPI paper analysis, citation formatting, research topic analysis, paper polishing, academic writing templates, and reproducible research examples. This is a collection; inspect the relevant nested SKILL.md before execution.",
    executionGuidance:
      "This selected scope is the qinyan-academic-skills collection. Inspect README.md first, then choose the relevant nested SKILL.md under skills/. For Qinyan OpenAPI subskills, require QINYAN_API_KEY and report a clear missing-credential limitation if it is unavailable. Do not fabricate paper metadata, citations, DOI, volume/issue/pages, or unsupported research trends. High-risk biomedical, clinical, financial, and grant outputs must include evidence boundaries and human-review requirements. Produce a Markdown research artifact at output_contract.preferred_artifact_path with sources, commands run, credential/API limitations, and validation notes."
  },
  "dianji-assistant": {
    outputContract: {
      required_output_format: "knowledge",
      preferred_artifact_path: "runs/dianji-assistant/output/dianji_answer.md"
    },
    selectionGuidance:
      "Use for Shanghai Dianji University / 上海电机学院 / 电机 public information lookup, official notices, news, documents, attachment downloads, public templates, forms, and simple form draft generation.",
    executionGuidance:
      "This selected skill must read the dianji-assistant SKILL.md first. Always query the local Operator Knowledge Base space dianji before public web search. Use operator.knowledge.search for every SDJU question, operator.knowledge.fetch for cited/downloaded items, operator.knowledge.find_template for template/form tasks, and operator.knowledge.fill_template only after required user fields are available. Every answer must cite source URL and item/version ids when available; if local search has no evidence, say the local 电机知识库 did not find a clear basis before asking whether to use public web search."
  },
  "text-to-cad": {
    outputContract: {
      required_output_format: "cad",
      preferred_artifact_path: "runs/text-to-cad/output/cad_result.md"
    },
    selectionGuidance:
      "Use for the upstream text-to-cad GitHub skill project across CAD, CAM, DXF, G-code, robot descriptions, and manufacturing workflows. For concrete STEP or parametric CAD generation, use its nested cad subskill from the resolved_source.subskills metadata.",
    executionGuidance:
      "This selected scope is a project-level CAD skill collection. Inspect the upstream README.md first, then choose and read the relevant nested SKILL.md under skills/. For STEP/parametric CAD tasks, use the nested subskill id cad from resolved_source.subskills, read its Operator adapter files, reuse its runtime commands step/inspect/snapshot, and do not create a task-local venv. Produce CAD artifacts when requested plus a Markdown report at output_contract.preferred_artifact_path listing generated files, commands, validation results, assumptions, and failures."
  },
  "claude-for-legal": {
    outputContract: {
      required_output_format: "legal",
      preferred_artifact_path: "runs/claude-for-legal/output/legal_result.md"
    },
    selectionGuidance:
      "Use for legal review, contracts, privacy, regulatory, AI governance, corporate, employment, IP, and litigation workflow research. This is a collection; inspect the relevant nested SKILL.md before execution.",
    executionGuidance:
      "This selected scope is a legal skill collection. Inspect README.md and the relevant nested SKILL.md before executing. Produce a Markdown legal-workflow artifact with assumptions, jurisdiction caveats, issues found, and explicit non-lawyer review requirements. Do not present output as legal advice."
  },
  "industrial-leak-detection": {
    outputContract: {
      required_output_format: "industrial_analysis",
      preferred_artifact_path: "runs/industrial-leak-detection/output/leak_analysis.json"
    },
    selectionGuidance:
      "Use for industrial inspection images that ask about water leaks, oil leaks, ground water stains, spray mist, or visual proxies of gas leakage.",
    executionGuidance:
      "This selected skill must inspect uploaded images directly from the task workspace and produce structured JSON at runs/industrial-leak-detection/output/leak_analysis.json plus a readable Markdown review. Keep confidence conservative, describe visible evidence, and mark gas leakage as a visual proxy unless dedicated gas sensor data is provided."
  },
  "industrial-meter-reading": {
    outputContract: {
      required_output_format: "industrial_analysis",
      preferred_artifact_path: "runs/industrial-meter-reading/output/meter_readings.json"
    },
    selectionGuidance:
      "Use for industrial inspection images that contain analog pointer gauges, LED/digital meters, or requested meter value extraction.",
    executionGuidance:
      "This selected skill must inspect uploaded images directly from the task workspace and produce structured JSON at runs/industrial-meter-reading/output/meter_readings.json plus a readable Markdown review. Record meter type, value/display text, unit when visible, status, confidence, and evidence; mark unreadable displays explicitly."
  }
};
