# Operator Adapter: text-to-cad-cad

This adapter is Operator execution guidance for the configured ACP execution agent. It does not replace the upstream CAD `SKILL.md`; read the upstream skill first, then apply these constraints.

## Execution Contract

Use `input.skill.runtime_context.commands` for CAD commands. These commands are already absolute and can be run from the task workspace:

```bash
<runtime_context.commands.step> SOURCE.py -o output/model.step
<runtime_context.commands.inspect> refs output/model.step --facts --planes --positioning
<runtime_context.commands.snapshot> --input output/model.step --output output/model.png
```

Do not create a venv in the task workspace. If `runtime_context.setup_complete_path` is missing, run `runtime_context.setup_commands` from `runtime_context.setup_cwd`.

## Required Order

1. Read `input.skill.evidence_path`.
2. Read this adapter.
3. Read only the upstream CAD references needed for the request:
   - `references/step-generation.md`
   - `references/build123d-modeling.md`
   - `references/inspection-and-validation.md`
   - `references/snapshot-review.md`
   - `references/positioning.md` only when source-level assembly placement matters.
4. Write a short CAD brief in the workspace.
5. Write one Python source file with a callable `gen_step()`.
6. Run `runtime_context.commands.step` on the Python source.
7. Run `runtime_context.commands.inspect refs` on the generated STEP.
8. Run `runtime_context.commands.snapshot` on the generated STEP when a STEP exists. If the snapshot script writes a timestamped PNG, use that actual saved path in the report and final JSON.
9. Write the requested Markdown report to `output_contract.preferred_artifact_path`.

## Hard Rules

- Do not import `gen_step` from `cadpy.generation`; `gen_step()` is the function you define in the generated source.
- Do not search `build123d` for assembly APIs in a loop. If a source-level assembly helper is needed, read `references/positioning.md` and use the documented `cadpy.assembly.AssemblyHelper` pattern.
- Do not repeatedly run the same exploratory Python command. After two failures of the same approach, either repair from the relevant reference file or return `status="failed"` with the exact error.
- Do not use broad `dir(build123d)` probing as the main implementation strategy.
- Do not use broad `dir(b3d.SomeClass)`, `dir(build123d.SomeClass)`, or list-comprehension module scans to discover build123d APIs. Operator may interrupt the run when those patterns appear.
- Do not claim success without a non-empty STEP file and a report file.
- For benchmark tasks, copy the benchmark requirements into the report and explicitly mark which checks passed, failed, or were not run.

## Safe Primitive Pattern

When exact profile operations become expensive, prefer direct build123d primitives over `BuildPart` exploration. For benchmark 10, this pattern is mandatory unless you already have a working generator from the upstream references. Copy it first, generate a STEP, then optionally improve visuals:

```python
from math import cos, radians, sin

from build123d import Box, Compound, Cylinder, Location
from cadpy.assembly import label_shape


def placed(shape, x, y, z=0.0, rz=0.0):
    return shape.located(Location((x, y, z), (0, 0, rz)))


def labeled_cylinder(label, radius, height, x=0.0, y=0.0, z=0.0):
    return label_shape(placed(Cylinder(radius=radius, height=height), x, y, z), label)


def gen_step():
    children = [
        labeled_cylinder("sun_gear", 27.0, 8.0),
        labeled_cylinder("ring_gear", 70.0, 8.0),
        label_shape(placed(Cylinder(radius=52.5, height=4.0), 0, 0, -3.0), "carrier_plate"),
    ]
    for index, angle in enumerate((0, 120, 240), start=1):
        x = 42.0 * cos(radians(angle))
        y = 42.0 * sin(radians(angle))
        children.append(labeled_cylinder(f"planet_gear_{index}", 20.5, 8.0, x, y))
        children.append(labeled_cylinder(f"planet_pin_{index}", 3.0, 14.0, x, y))
    assembly = Compound(children=children)
    assembly.label = "planetary_gear_stage"
    return assembly
```

For benchmark 10:

- Do not import broad build123d symbol lists.
- Do not import `BuildPart`, `BuildSketch`, `WorkPlane`, `Extruder`, `PolarArray`, `PrismaticTension`, `RectangularChamfer`, or `make_loft`.
- Do not run Python API discovery commands.
- Do not write generated Python with terminal heredocs. Use `file_editor` for source files.
- Start from the safe primitive pattern above.
- For better visual teeth, add simple labeled `Box` tooth markers around each gear only after the basic labeled compound exports successfully.
- Do not block STEP generation on exact involute teeth.

## Benchmark 10 Notes

For `benchmarks/10-planetary-gear-stage.md`, prefer a simple static assembly/compound of labeled solids over advanced dynamic joints. The benchmark validates visible geometry and dimensions, not simulated gear motion.

For this benchmark, first copy the Operator adapter source file
`skills/adapters/text-to-cad-cad/benchmark-10-safe.py` into the task workspace
as the generator. Run the upstream `step` command on that copy before making
any improvements. Do not rewrite the generator from memory until the copied
safe version has produced a non-empty STEP file.

Use explicit labels for:

- `sun_gear`
- `planet_gear_1`, `planet_gear_2`, `planet_gear_3`
- `ring_gear`
- `carrier_plate`
- `planet_pin_1`, `planet_pin_2`, `planet_pin_3`

The source should create nine separate labeled solids:

- sun gear: 24 teeth, pitch 48 mm, root 42 mm, outside 54 mm, 8 mm thick, 10 mm bore;
- three planet gears: 18 teeth, pitch 36 mm, root 31 mm, outside 41 mm, centers on 42 mm radius at 120 degree spacing;
- ring gear: outside 140 mm, internal 60 teeth, tooth tip 114 mm, pitch 120 mm, root 126 mm;
- carrier plate: diameter 105 mm, 4 mm thick, Z from -5 to -1;
- three planet pins: 6 mm diameter, 14 mm high, aligned under the planet centers.

If exact involute gear teeth are too costly, use simplified straight-sided trapezoidal teeth and state that assumption in the report. Keep dimensions parameterized and inspectable.

## Expected Failure Behavior

If STEP generation, inspection, or snapshot fails, do not fabricate artifacts. Write a failure report at `output_contract.preferred_artifact_path` only if the report itself can be verified, and return `status="failed"` with the failing command and stderr.
