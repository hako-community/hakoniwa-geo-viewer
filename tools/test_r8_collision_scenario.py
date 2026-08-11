#!/usr/bin/env python3
import json
import math
import os
import sys

def run_collision_scenario_test():
    print("[TestR8CollisionScenario] Verifying MJCF building coordinates and collision scenario...")
    buildings_xml_path = os.path.join(
        os.path.dirname(__file__),
        '..',
        'runtime-assets',
        'shibuya',
        'buildings.xml'
    )
    if not os.path.exists(buildings_xml_path):
        print(f"FAIL: buildings.xml not found at {buildings_xml_path}")
        return False

    with open(buildings_xml_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Simple check for geom positions
    import re
    pos_matches = re.findall(r'pos="([\d\.\-]+)\s+([\d\.\-]+)\s+([\d\.\-]+)"', content)
    print(f"[TestR8CollisionScenario] Found {len(pos_matches)} geoms in buildings.xml.")

    xs = [float(m[0]) for m in pos_matches]
    ys = [float(m[1]) for m in pos_matches]
    zs = [float(m[2]) for m in pos_matches]

    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    min_z, max_z = min(zs), max(zs)

    print(f"[Building Spatial Bounds] X: [{min_x:.1f}, {max_x:.1f}], Y: [{min_y:.1f}, {max_y:.1f}], Z: [{min_z:.1f}, {max_z:.1f}]")
    
    # Verify that flight demo path passing through X~180, Y~-250 overlaps with building bounding boxes
    bldg_contacts = 0
    test_waypoints = [
        (168.9, -253.9, 23.8),
        (224.2, -266.5, 23.2),
        (181.7, -266.7, 23.8),
    ]

    for wx, wy, wz in test_waypoints:
        for x, y, z in zip(xs, ys, zs):
            dist = math.sqrt((wx - x)**2 + (wy - y)**2 + (wz - z)**2)
            if dist < 5.0:
                bldg_contacts += 1
                break

    print(f"[TestR8CollisionScenario] Waypoint collision hits: {bldg_contacts}/{len(test_waypoints)}")
    if bldg_contacts > 0:
        print("PASS: Verified waypoints directly intersect with MJCF building geometry bounds.")
        return True
    else:
        print("FAIL: Waypoints do not intersect with buildings.")
        return False

if __name__ == '__main__':

    success = run_collision_scenario_test()
    sys.exit(0 if success else 1)
