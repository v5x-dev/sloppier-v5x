# Renders one GLB model headless, for reviewing Part models against the STEP.
#
#   blender --background --factory-startup --python tools/render.py -- \
#     <in.glb> <out.png> <yaw_deg> <pitch_deg> <distance_x_size> <pixels> [overlay.json]
#
# The camera orbits the model's bounding-box centre. `distance_x_size` is the camera
# distance as a multiple of the model's diagonal. Vertex colours (COLOR_0), when present,
# drive the base colour; otherwise the glTF material colour is used.
#
# Optional overlay.json: {"points": [[x, y, z, r, g, b], ...]} draws small spheres at Part-frame
# positions (Y up, mm), used to check Snap Points against a rebuilt mesh.

import json
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
glb_path, out_path = argv[0], argv[1]
yaw, pitch, dist_k, pixels = (float(argv[2]), float(argv[3]), float(argv[4]), int(argv[5]))
overlay = json.load(open(argv[6])) if len(argv) > 6 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb_path)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for obj in meshes:
    # glTF is Y up and so is Blender's glTF importer's output after its axis conversion.
    mesh = obj.data
    attr = mesh.color_attributes[0].name if len(mesh.color_attributes) else None
    mat = bpy.data.materials.new("review")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = 0.45
    bsdf.inputs["Metallic"].default_value = 0.0
    if attr:
        color = nodes.new("ShaderNodeVertexColor")
        color.layer_name = attr
        links.new(color.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        old = [m for m in obj.material_slots if m.material]
        if old:
            base = old[0].material.node_tree.nodes.get("Principled BSDF")
            if base:
                bsdf.inputs["Base Color"].default_value = base.inputs["Base Color"].default_value
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for poly in mesh.polygons:
        poly.use_smooth = True

# Bounding box in world space, for the camera.
lo = Vector((math.inf,) * 3)
hi = Vector((-math.inf,) * 3)
for obj in meshes:
    for corner in obj.bound_box:
        world = obj.matrix_world @ Vector(corner)
        for k in range(3):
            lo[k] = min(lo[k], world[k])
            hi[k] = max(hi[k], world[k])
center = (lo + hi) / 2
diag = (hi - lo).length

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 48
scene.cycles.use_denoising = True
scene.render.resolution_x = pixels
scene.render.resolution_y = pixels
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = out_path
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "None"

# Dim neutral world, with a soft key and fill so form reads clearly.
world = bpy.data.worlds.new("review")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.045, 0.04, 0.05, 1.0)
bg.inputs["Strength"].default_value = 1.0
scene.world = world


def light(energy, direction, angle_deg):
    """A sun lamp shining along `direction` (from the light towards the model)."""
    data = bpy.data.lights.new(name="sun", type="SUN")
    data.energy = energy
    data.angle = math.radians(angle_deg)
    obj = bpy.data.objects.new("sun", data)
    bpy.context.collection.objects.link(obj)
    obj.rotation_euler = Vector(direction).normalized().to_track_quat("-Z", "Y").to_euler()
    return obj


# Key from above and to the front-right, fill from the left: form reads, and the
# shadows stay soft enough that black plastic does not vanish.
light(4.0, (-1.0, 1.2, -1.6), 3.0)
light(1.2, (1.2, 0.6, 0.4), 12.0)

# Orbit camera.
yaw_r, pitch_r = math.radians(yaw), math.radians(pitch)
offset = Vector(
    (
        math.cos(pitch_r) * math.sin(yaw_r),
        -math.cos(pitch_r) * math.cos(yaw_r),
        math.sin(pitch_r),
    )
) * (dist_k * diag)
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 50
cam = bpy.data.objects.new("cam", cam_data)
cam.location = center + offset
bpy.context.collection.objects.link(cam)
cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam

if overlay:
    marker = bpy.data.meshes.new("marker")
    for i, p in enumerate(overlay["points"]):
        mat_m = bpy.data.materials.new(f"m{i}")
        mat_m.diffuse_color = (p[3], p[4], p[5], 1.0)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.9, location=(p[0], p[1], p[2]))
        sphere = bpy.context.active_object
        sphere.data.materials.append(mat_m)
        sphere.name = f"snap-{i}"

bpy.ops.render.render(write_still=True)
print("rendered", out_path)
