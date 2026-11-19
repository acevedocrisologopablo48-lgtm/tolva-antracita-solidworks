import * as THREE from "three";

// Each parcel carries its physical position and equivalent-volume radius in metres.
// Repeated frames keep one slot per parcel, including slots with radius zero.
const SHAPES = 8;
const VOLUME_UNIT_SPHERE = 4 * Math.PI / 3;
const PALETTE = [0x25282a, 0x292b2e, 0x303337, 0x35373a, 0x2c2e31, 0x383a3d, 0x25272b, 0x404144];

function randomSource(seed) {
  let n = seed >>> 0;
  return () => {
    n = (Math.imul(1664525, n) + 1013904223) >>> 0;
    return n / 4294967296;
  };
}

function makeStone(index) {
  const rand = randomSource(56927 + 1381 * index);
  const count = 7 + index % 2;
  const width = .98 + .20 * rand(), depth = .80 + .20 * rand(), height = .71 + .18 * rand();
  const points = [], faces = [], tones = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const normal = new THREE.Vector3(), centre = new THREE.Vector3(), cross = new THREE.Vector3();
  let volume = 0;

  // Three irregular rings form broad fracture planes and chipped edges.
  const ringParameters = Array.from({length:count}, (_, i) => ({
    angle:2 * Math.PI * (i + (rand() - .5) * .45) / count,
    radius:.81 + .28 * rand()
  }));
  const offset = rand() * 2 * Math.PI;
  for (let level = 0; level < 3; level++) {
    for (const vertex of ringParameters) {
      const shrink = level === 1 ? 1 : .48 + .34 * rand();
      const angle = offset + vertex.angle + (level === 1 ? 0 : (rand() - .5) * .23);
      const x = width * shrink * vertex.radius * Math.cos(angle);
      const y = depth * shrink * vertex.radius * Math.sin(angle);
      const z = height * ((level - 1) * (.76 + .13 * rand()) + (rand() - .5) * .29) + x * .10 - y * .07;
      points.push(new THREE.Vector3(x, y, z));
    }
  }
  points.push(new THREE.Vector3(.08, -.09, -height * (.88 + .1 * rand())));
  points.push(new THREE.Vector3(-.10, .07, height * (.89 + .11 * rand())));
  function triangle(i, j, k, tone) {
    a.copy(points[i]); b.copy(points[j]); c.copy(points[k]);
    normal.crossVectors(new THREE.Vector3().subVectors(b,a), new THREE.Vector3().subVectors(c,a));
    centre.copy(a).add(b).add(c);
    if (normal.dot(centre) < 0) { b.copy(points[k]); c.copy(points[j]); }
    volume += a.dot(cross.crossVectors(b,c)) / 6;
    for (const v of [a,b,c]) {
      faces.push(v.x,v.y,v.z);
      tones.push(tone,tone,tone);
    }
  }
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    for (let level = 0; level < 2; level++) {
      const p = level * count, q = p + count;
      const tone = .80 + rand() * .19;
      triangle(p+i,p+j,q+j,tone);
      triangle(p+i,q+j,q+i,tone * (.95 + .07 * rand()));
    }
    triangle(3*count, j, i, .84 + .14 * rand());
    triangle(3*count+1, 2*count+i, 2*count+j, .88 + .12 * rand());
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(faces,3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(tones,3));
  const scale = Math.cbrt(VOLUME_UNIT_SPHERE / volume);
  geometry.scale(scale,scale,scale);
  geometry.computeVertexNormals();
  return geometry;
}

function applyGranularSurface(material) {
  // One repeatable scalar volume. Mipmapping removes subpixel shimmer while the pile moves.
  const size = 32, samples = new Uint8Array(size**3);
  const rand = randomSource(79391);
  for (let i=0; i<samples.length; i++) samples[i]=Math.floor(256*rand());
  const field = new THREE.Data3DTexture(samples,size,size,size);
  field.format = THREE.RedFormat;
  field.wrapS = field.wrapT = field.wrapR = THREE.RepeatWrapping;
  field.magFilter = THREE.LinearFilter;
  field.minFilter = THREE.LinearMipmapLinearFilter;
  field.generateMipmaps = true;
  field.needsUpdate = true;
  material.onBeforeCompile = shader => {
    shader.uniforms.coalField = {value:field};
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCoalMetres;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vec3 basisX = instanceMatrix[0].xyz;
        vCoalMetres = position * length(basisX) + normalize(basisX) * 0.28;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform highp sampler3D coalField;\nvarying vec3 vCoalMetres;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        // Cell widths in metres. Texture coordinates travel with each parcel.
        float aggregate = texture(coalField, vCoalMetres / (32.0*0.012)).r - 0.5;
        float grain = texture(coalField, vCoalMetres / (32.0*0.0048)).r - 0.5;
        float fines = texture(coalField, vCoalMetres / (32.0*0.0016)).r - 0.5;
        diffuseColor.rgb *= 1.0 + 0.35*aggregate + 1.15*grain + 0.65*fines;
        float relief = grain*0.00065 + fines*0.00017;
      `)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        vec3 coalDx = dFdx(-vViewPosition), coalDy = dFdy(-vViewPosition);
        vec3 coalU = cross(coalDy,normal), coalV = cross(normal,coalDx);
        float coalDet = dot(coalDx,coalU);
        if(abs(coalDet)>1e-14) {
          normal=normalize(normal-(dFdx(relief)*coalU+dFdy(relief)*coalV)/coalDet);
        }
      `);
  };
  material.customProgramCacheKey = () => "coal-granular-surface-v1";
  return field;
}

export function createBulkMaterial(scene, {capacity=4500, seed=7591}={}) {
  const group = new THREE.Group();
  group.name = "Antracita a granel";
  const mineral = new THREE.MeshPhongMaterial({
    color:0xffffff, vertexColors:true, flatShading:true,
    specular:0x141619, shininess:12
  });
  const grainField = applyGranularSurface(mineral);
  const geometries = Array.from({length:SHAPES}, (_, i) => makeStone(i));
  const rand = randomSource(seed);
  const colours = PALETTE.map(hex => new THREE.Color(hex));
  const baseTransforms = [], shadeIndices = [];
  const perShapeCount = new Uint32Array(SHAPES);
  const quaternion = new THREE.Quaternion();
  const rotation = new THREE.Matrix4(), matrix = new THREE.Matrix4();
  let meshes = [], maxSlots = 0;
  function allocate(total) {
    if (total <= maxSlots) return;
    // Keep orientation and shade tied to the input slot, even after a particle leaves.
    for (let i = maxSlots; i < total; i++) {
      const u = rand(), a = 2*Math.PI*rand(), b = 2*Math.PI*rand();
      quaternion.set(Math.sqrt(1-u)*Math.sin(a), Math.sqrt(1-u)*Math.cos(a),
                     Math.sqrt(u)*Math.sin(b), Math.sqrt(u)*Math.cos(b));
      rotation.makeRotationFromQuaternion(quaternion);
      const e = rotation.elements;
      baseTransforms.push([e[0],e[1],e[2],e[4],e[5],e[6],e[8],e[9],e[10]]);
      shadeIndices.push(Math.floor(rand() * colours.length));
    }
    for (const mesh of meshes) { group.remove(mesh); mesh.dispose(); }
    meshes = geometries.map((geometry,i) => {
      const mesh = new THREE.InstancedMesh(geometry,mineral,Math.ceil(total/SHAPES));
      mesh.name = "Fragmentos de antracita "+(i+1);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0,colours[0]);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count=0; group.add(mesh); return mesh;
    });
    maxSlots=total;
  }
  allocate(Math.max(1,Math.ceil(capacity)));
  scene.add(group);

  function update(packed, count=packed.length/4) {
    const n = Math.min(Math.floor(count),Math.floor(packed.length/4));
    allocate(n);
    perShapeCount.fill(0);
    for (let i=0; i<n; i++) {
      const j=4*i, x=packed[j], y=packed[j+1], z=packed[j+2], r=packed[j+3];
      if (!(r>0) || !Number.isFinite(x+y+z+r)) continue;
      const shape=i%SHAPES, target=perShapeCount[shape]++;
      const basis=baseTransforms[i], elements=matrix.elements;
      for (let col=0; col<3; col++) {
        for (let row=0; row<3; row++) elements[4*col+row]=basis[3*col+row]*r;
      }
      matrix.setPosition(x,y,z);
      meshes[shape].setMatrixAt(target,matrix);
      meshes[shape].setColorAt(target,colours[shadeIndices[i]]);
    }
    for (let i=0; i<SHAPES; i++) {
      const mesh=meshes[i];
      mesh.count=perShapeCount[i]; mesh.instanceMatrix.needsUpdate=true; mesh.instanceColor.needsUpdate=true;
    }
  }
  function dispose() {
    group.removeFromParent();
    for (const mesh of meshes) mesh.dispose();
    for (const geometry of geometries) geometry.dispose();
    grainField.dispose();
    mineral.dispose();
    group.clear();
  }
  return {group,update,setVisible(visible){group.visible=Boolean(visible);},dispose};
}

