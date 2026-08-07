import struct, json, sys

with open('/Users/dmitri/Desktop/shishka-bank/3d-models/v2/fox_ascended_v2.glb', 'rb') as f:
    header = f.read(12)
    magic = header[0:4]
    version = struct.unpack('<I', header[4:8])[0]
    total_len = struct.unpack('<I', header[8:12])[0]
    print(f'Magic: {magic} — {"VALID" if magic == b"glTF" else "INVALID"}')
    print(f'Version: {version}')
    print(f'Total size: {total_len:,} bytes ({total_len/1024/1024:.1f} MB)')

    while True:
        chunk_header = f.read(8)
        if len(chunk_header) < 8:
            break
        chunk_len = struct.unpack('<I', chunk_header[0:4])[0]
        chunk_type = chunk_header[4:8].decode('ascii', errors='replace')
        print(f'\n--- Chunk: {chunk_type}, length: {chunk_len:,} bytes ---')

        chunk_data = f.read(chunk_len)

        if chunk_type == 'JSON':
            gltf = json.loads(chunk_data)
            print(f'Meshes: {len(gltf.get("meshes",[]))}')
            print(f'Nodes: {len(gltf.get("nodes",[]))}')
            print(f'Materials: {len(gltf.get("materials",[]))}')
            print(f'Textures: {len(gltf.get("textures",[]))}')
            print(f'Images: {len(gltf.get("images",[]))}')
            print(f'Accessors: {len(gltf.get("accessors",[]))}')

            scene_idx = gltf.get('scene', 0)
            scenes = gltf.get('scenes', [])
            if scene_idx < len(scenes):
                root_nodes = scenes[scene_idx].get('nodes', [])
                print(f'Root nodes in default scene: {len(root_nodes)}')

            for mi, mesh in enumerate(gltf.get('meshes', [])):
                for pi, prim in enumerate(mesh.get('primitives', [])):
                    pos_acc = prim.get('attributes', {}).get('POSITION')
                    idx_acc = prim.get('indices')
                    mat_idx = prim.get('material', -1)
                    v = gltf['accessors'][pos_acc]['count'] if pos_acc is not None else 0
                    tri = gltf['accessors'][idx_acc]['count'] // 3 if idx_acc is not None else 0
                    mode = prim.get('mode', 4)
                    mode_names = {0:'POINTS',1:'LINES',2:'LINE_LOOP',3:'LINE_STRIP',4:'TRIANGLES',5:'TRIANGLE_STRIP',6:'TRIANGLE_FAN'}
                    print(f'  Mesh {mi} Prim {pi}: {v} verts, {tri} tris, mode={mode_names.get(mode, mode)}, material={mat_idx}')

            for mi, mat in enumerate(gltf.get('materials', [])):
                name = mat.get('name', f'Material_{mi}')
                has_pbr = 'pbrMetallicRoughness' in mat
                has_emission = 'emissiveTexture' in mat or 'emissiveFactor' in mat
                has_normal = 'normalTexture' in mat
                print(f'  Material "{name}": PBR={has_pbr}, emission={has_emission}, normal={has_normal}')
