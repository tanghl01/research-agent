---
name: industrial-leak-detection
description: Analyze industrial inspection images for leaks, stains, spray mist, and gas-leak visual proxies.
---

# Industrial Leak Detection

Use this skill when the user uploads industrial inspection images and asks for leakage or abnormal-fluid analysis.

## Scope

Detect and report:

- water leak
- oil leak
- ground water stain or wet floor
- spray mist or jetting water
- likely gas leak proxy, such as visible vapor plume, frost, condensate, dust disturbance, or warning signage

Do not claim invisible gas is confirmed from an image alone. Mark it as `suspected_gas_leak_proxy` unless the image contains direct instrumentation, labels, or visible plume evidence.

## Required Outputs

Write all outputs inside `runtime_context.workspace_absolute`:

- `runs/industrial-leak-detection/output/leak_analysis.json`
- `runs/industrial-leak-detection/output/leak_review.md`
- optional annotated image/SVG files under `runs/industrial-leak-detection/output/`

The JSON must use this shape:

```json
{
  "schema": "operator.industrial.leak_detection.v1",
  "images": [
    {
      "path": "input/attachments/example.jpg",
      "findings": [
        {
          "type": "water_leak|oil_leak|water_stain|spray_mist|suspected_gas_leak_proxy|normal|uncertain",
          "severity": "low|medium|high|critical|unknown",
          "confidence": 0.0,
          "bbox": { "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0 },
          "evidence": "Short visible evidence.",
          "recommended_action": "Short operational action."
        }
      ]
    }
  ],
  "summary": {
    "risk_level": "low|medium|high|critical|unknown",
    "requires_shutdown_review": false,
    "notes": []
  }
}
```

Use normalized bbox coordinates from 0 to 1 when possible. If a bounding box is not defensible, omit `bbox` and explain uncertainty in `evidence`.

## Method

1. Read the uploaded image paths listed in the prompt.
2. Inspect each image visually.
3. Identify leak/stain/mist/gas-proxy evidence with conservative confidence.
4. Separate confirmed visible evidence from guesses.
5. Produce the JSON and Markdown files.
6. Verify the files exist before replying.

## Quality Bar

- Every finding must cite visible evidence.
- Do not invent equipment metadata that is not visible or provided.
- If the image is blurry or unsuitable, output `uncertain` with a reason.
- Mention urgent review for high-pressure spray, oil near electrical equipment, large wet floor areas, or suspected gas-leak proxies.
