"""Safe primitive benchmark 10 generator for the Operator text-to-cad adapter.

This file is guidance for the configured ACP execution agent. Copy it into the
task workspace when the request is earthtojake/text-to-cad benchmark 10, then
run the upstream CAD skill's `scripts/step` command on the copy.
"""

from math import cos, radians, sin

from build123d import Box, Compound, Cylinder, Location
from cadpy.assembly import label_shape


def placed(shape, x=0.0, y=0.0, z=0.0, rz=0.0):
    return shape.located(Location((x, y, z), (0, 0, rz)))


def labeled(shape, label):
    return label_shape(shape, label)


def labeled_cylinder(label, radius, height, x=0.0, y=0.0, z=0.0):
    return labeled(placed(Cylinder(radius=radius, height=height), x, y, z), label)


def tooth_markers(prefix, count, radius, length, width, height, z=0.0):
    markers = []
    for index in range(count):
        angle = 360.0 * index / count
        x = radius * cos(radians(angle))
        y = radius * sin(radians(angle))
        tooth = placed(Box(length=length, width=width, height=height, rotation=(0, 0, angle)), x, y, z, angle)
        markers.append(labeled(tooth, f"{prefix}_tooth_{index + 1:02d}"))
    return markers


def gen_step():
    children = []

    sun = Cylinder(radius=27.0, height=8.0) - Cylinder(radius=5.0, height=10.0)
    children.append(labeled(sun, "sun_gear"))
    children.extend(tooth_markers("sun_gear", 24, 25.5, 5.0, 3.0, 8.0))

    ring = Cylinder(radius=70.0, height=8.0) - Cylinder(radius=57.0, height=10.0)
    children.append(labeled(ring, "ring_gear"))
    children.extend(tooth_markers("ring_gear_internal", 60, 58.5, 4.0, 2.0, 8.0))

    children.append(labeled_cylinder("carrier_plate", 52.5, 4.0, z=-3.0))

    for index, angle in enumerate((0.0, 120.0, 240.0), start=1):
        x = 42.0 * cos(radians(angle))
        y = 42.0 * sin(radians(angle))
        children.append(labeled_cylinder(f"planet_gear_{index}", 20.5, 8.0, x, y))
        children.extend(tooth_markers(f"planet_gear_{index}", 18, 19.0, 4.0, 2.5, 8.0))
        children.append(labeled_cylinder(f"planet_pin_{index}", 3.0, 14.0, x, y))

    assembly = Compound(children=children)
    assembly.label = "planetary_gear_stage"
    return assembly
