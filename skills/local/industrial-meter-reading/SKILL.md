---
name: industrial-meter-reading
description: Read analog pointer gauges and LED/digital meters from industrial inspection images.
---

# Industrial Meter Reading

Use this skill when the user uploads industrial inspection images and asks for instrument values, gauge readings, or meter data extraction.

## Supported Meter Types

- `analog_pointer`: round or arc gauges with a needle/pointer
- `digital_led`: LED/LCD numeric displays
- `unknown`: meter is present but type or value cannot be read reliably

## Required Outputs

Write all outputs inside `runtime_context.workspace_absolute`:

- `runs/industrial-meter-reading/output/meter_readings.json`
- `runs/industrial-meter-reading/output/meter_review.md`
- optional annotated image/SVG files under `runs/industrial-meter-reading/output/`

The JSON must use this shape:

```json
{
  "schema": "operator.industrial.meter_reading.v1",
  "images": [
    {
      "path": "input/attachments/example.jpg",
      "readings": [
        {
          "meter_type": "analog_pointer|digital_led|unknown",
          "value": 12.3,
          "unit": "MPa",
          "display_text": "12.3",
          "confidence": 0.0,
          "bbox": { "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0 },
          "evidence": "Needle position or visible digits.",
          "range_min": 0,
          "range_max": 16,
          "status": "normal|warning|alarm|unknown"
        }
      ]
    }
  ],
  "summary": {
    "readable_count": 0,
    "unreadable_count": 0,
    "notes": []
  }
}
```

Use normalized bbox coordinates from 0 to 1 when possible.

## Method

For analog pointer gauges:

1. Identify scale minimum, maximum, major tick labels, unit, and pointer angle.
2. Estimate the value from pointer position.
3. If scale labels are not readable, report `unknown` and cite the visibility issue.

For LED/digital meters:

1. Read the visible digits and decimal point.
2. Capture visible units or labels.
3. Flag glare, occlusion, missing segments, or partial digits.

## Quality Bar

- Do not overstate precision. Use approximate values when scale visibility is limited.
- Always include confidence and visual evidence.
- If multiple meters appear in one image, return one reading object per meter.
- Verify JSON and Markdown outputs exist before replying.
