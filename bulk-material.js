import * as THREE from "three";

// Transport slots carry the centroid and equivalent radius of a parcel, in metres.
// They are never drawn. A density field supplies the bulk interior, while sub-grain
// samples supply the true-scale edge and dilute stream without proxy particle meshes.
const SAMPLES = 768;
const NX = 76, NY = 76, NZ = 68;
const ISO = 70 / 255;
function randomSource(seed) {
  let n=seed>>>0;
  return () => { n=(Math.imul(n,1664525)+1013904223)>>>0; return n/4294967296; };
}
function volumeTexture(data,x,y,z) {
  const t=new THREE.Data3DTexture(data,x,y,z);
  t.format=THREE.RedFormat; t.magFilter=t.minFilter=THREE.LinearFilter;
  t.unpackAlignment=1;t.needsUpdate=true;
  return t;
}
const vesselClip = `
  uniform float collar, clipVessel;
  bool crossesWall(vec3 p) {
    if(clipVessel<0.5 || p.z<1.6 || p.z>3.3) return false;
    float fraction=clamp((p.z-1.6)/(1.7-collar),0.0,1.0);
    vec2 halfWidth=mix(vec2(.6,.4),vec2(1.725),fraction);
    return any(greaterThan(abs(p.xy),halfWidth));
  }
`;
const surfaceVertex=`
  varying vec3 world;
  void main(){world=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.0);}
`;
const surfaceFragment=`
  precision highp float;
  uniform highp sampler3D densityField, grainField;
  uniform vec3 origin, worldSize, low, high, eyeAxis;
  uniform float voxel, maxDiameter, pixelMetres, ortho;
  uniform mat4 clipMatrix;
  varying vec3 world;
  ${vesselClip}
  const float threshold=${ISO.toFixed(8)};
  float density(vec3 p){return texture(densityField,(p-origin)/worldSize).r;}
  float grain(vec3 pos,float stepMetres){
    vec3 uv=pos/(32.0*stepMetres);
    return textureLod(grainField,uv,max(0.0,log2(max(1.0,pixelMetres/stepMetres)))).r-.5;
  }
  void main(){
    vec3 dir=ortho>0.5?eyeAxis:normalize(world-cameraPosition);
    float stride=voxel*.66;
    vec3 p=world+dir*.00002;
    // The front-face of the active field is the entry point of the view ray.
    // Orthographic zeros require an explicit parallel component.
    vec3 inv=vec3(dir.x>=0.0?1.0:-1.0,dir.y>=0.0?1.0:-1.0,dir.z>=0.0?1.0:-1.0)/max(abs(dir),vec3(.000001));
    vec3 end=max((low-p)*inv,(high-p)*inv);
    float distance=min(end.x,min(end.y,end.z)), prev=density(p), travelled=0.0;
    bool found=false;
    for(int i=0;i<230;i++){
      if(travelled>distance+.001)break;
      float d=density(p);
      if(d>=threshold && !crossesWall(p)){
        float back=(d>prev+.00001)?clamp((d-threshold)/(d-prev),0.0,1.0):0.0;
        vec3 refined=p-dir*back*stride;
        if(!crossesWall(refined))p=refined;
        found=true;break;
      }
      prev=d;p+=dir*stride;travelled+=stride;
    }
    if(!found)discard;
    float h=voxel*.8;
    vec3 n=vec3(density(p-vec3(h,0,0))-density(p+vec3(h,0,0)),
                density(p-vec3(0,h,0))-density(p+vec3(0,h,0)),
                density(p-vec3(0,0,h))-density(p+vec3(0,0,h)));
    n=length(n)>.00001?normalize(n):-dir;
    float broad=grain(p,.011), grit=grain(p,maxDiameter*.76), fine=grain(p,maxDiameter*.24);
    float light=.69+.36*max(0.0,dot(n,normalize(vec3(-.45,-.58,.74))))+.12*max(0.0,dot(n,normalize(vec3(.53,.64,.55))));
    float shade=light*(.193 + .043*broad + .098*grit + .059*fine);
    gl_FragColor=vec4(shade*.95,shade*.98,shade,1.0);
    vec4 clip=clipMatrix*vec4(p,1.0);gl_FragDepth=.5*(clip.z/clip.w+1.0);
  }
`;
const pointsVertex=`
  attribute vec4 parcel;attribute float slotSeed;
  attribute vec2 sizeTone;
  uniform float pixelsPerMetre, maxDiameter, ortho, sampleWeight;
  varying float tone, coverage;varying vec3 world;
  void main(){
    float c=cos(slotSeed),s=sin(slotSeed);
    vec3 offset=position;
    offset.xy=mat2(c,s,-s,c)*offset.xy;
    if(fract(slotSeed*.31)>.5)offset.z=-offset.z;
    world=parcel.xyz+offset*parcel.w;
    vec4 mv=viewMatrix*vec4(world,1.0);
    float dia=maxDiameter*sizeTone.x;
    float pixels=dia*pixelsPerMetre/(ortho>.5?1.0:max(.001,-mv.z));
    // At subpixel scales a projected disk contributes its true fractional coverage.
    // LOD weights only merge subpixel samples; resolved grain diameters never grow.
    coverage=min(1.0,pixels*pixels*.785398*sampleWeight);
    tone=sizeTone.y;
    gl_PointSize=max(1.0,pixels);
    gl_Position=projectionMatrix*mv;
  }
`;
const pointsFragment=`
  varying float tone,coverage;varying vec3 world;
  ${vesselClip}
  void main(){
    if(crossesWall(world))discard;
    vec2 q=gl_PointCoord*2.0-1.0;float r2=dot(q,q);
    if(r2>1.0)discard;
    float light=.78+.22*sqrt(max(0.0,1.0-r2))+.1*(-q.x+q.y);
    float s=(.114+.125*tone)*light;
    gl_FragColor=vec4(s*.96,s*.98,s,coverage);
  }
`;

export function createBulkMaterial(scene,{capacity=1200,seed=7591}={}) {
  const group=new THREE.Group();group.name="Antracita fina a granel";scene.add(group);
  const rand=randomSource(seed), field=new Uint8Array(NX*NY*NZ);
  const densityField=volumeTexture(field,NX,NY,NZ);
  const grains=new Uint8Array(32**3);
  for(let i=0;i<grains.length;i++)grains[i]=Math.floor(256*rand());
  const grainField=volumeTexture(grains,32,32,32);
  grainField.wrapS=grainField.wrapT=grainField.wrapR=THREE.RepeatWrapping;
  grainField.minFilter=THREE.LinearMipmapLinearFilter;grainField.generateMipmaps=true;
  const low=new THREE.Vector3(),high=new THREE.Vector3(),origin=new THREE.Vector3(),worldSize=new THREE.Vector3();
  const cameraDirection=new THREE.Vector3(), clipMatrix=new THREE.Matrix4(), viewport=new THREE.Vector2();
  const common={maxDiameter:{value:.003},collar:{value:.9},clipVessel:{value:0},ortho:{value:1}};
  const surfaceUniforms={...common,densityField:{value:densityField},grainField:{value:grainField},origin:{value:origin},worldSize:{value:worldSize},
    low:{value:low},high:{value:high},eyeAxis:{value:cameraDirection},voxel:{value:.048},clipMatrix:{value:clipMatrix},pixelMetres:{value:.005}};
  const surfaceMat=new THREE.ShaderMaterial({uniforms:surfaceUniforms,vertexShader:surfaceVertex,fragmentShader:surfaceFragment});
  const surface=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),surfaceMat);
  surface.visible=false;surface.name="Continuo de densidad";group.add(surface);
  const geo=new THREE.InstancedBufferGeometry();
  const offsets=new Float32Array(SAMPLES*3),sizes=new Float32Array(SAMPLES*2);
  for(let i=0;i<SAMPLES;i++){
    // A smoothly tapered distribution has no spherical boundary for an isolated parcel.
    // Use a deterministic sample layout, scrambled separately for each slot.
    for(let k=0;k<3;k++)offsets[3*i+k]=(rand()+rand()+rand()-1.5)*(k===2?1.26:1.17);
    sizes[2*i]=.025+.975*rand()**.62;sizes[2*i+1]=rand();
  }
  geo.setAttribute("position",new THREE.BufferAttribute(offsets,3));
  geo.setAttribute("sizeTone",new THREE.BufferAttribute(sizes,2));
  let storage=0,particles,seeds;
  function reserve(n){
    if(n<=storage)return;
    storage=Math.max(n,capacity,1);
    particles=new THREE.InstancedBufferAttribute(new Float32Array(storage*4),4).setUsage(THREE.DynamicDrawUsage);
    seeds=new THREE.InstancedBufferAttribute(new Float32Array(storage),1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("parcel",particles);geo.setAttribute("slotSeed",seeds);
  }
  reserve(capacity);geo.instanceCount=0;
  const pointUniforms={...common,pixelsPerMetre:{value:1},sampleWeight:{value:1}};
  const pointMat=new THREE.ShaderMaterial({uniforms:pointUniforms,vertexShader:pointsVertex,fragmentShader:pointsFragment,
    transparent:true,depthTest:true,depthWrite:false});
  const cloud=new THREE.Points(geo,pointMat);
  cloud.frustumCulled=false;cloud.name="Granos a diámetro real";group.add(cloud);
  const viewportParams=(renderer,camera)=>{
    renderer.getDrawingBufferSize(viewport);
    common.ortho.value=camera.isOrthographicCamera?1:0;
    return .5*viewport.y*camera.projectionMatrix.elements[5];
  };
  surface.onBeforeRender=(renderer,_scene,camera)=>{
    const ppm=viewportParams(renderer,camera);
    camera.getWorldDirection(cameraDirection);clipMatrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    surfaceUniforms.pixelMetres.value=1/ppm;
  };
  cloud.onBeforeRender=(renderer,_scene,camera)=>{
    const ppm=viewportParams(renderer,camera);pointUniforms.pixelsPerMetre.value=ppm;
    const estPixels=ppm*common.maxDiameter.value/(camera.isOrthographicCamera?1:Math.max(.2,camera.position.distanceTo(surface.position)));
    const samples=estPixels<.72?160:estPixels<1?384:SAMPLES;
    geo.setDrawRange(0,samples);pointUniforms.sampleWeight.value=SAMPLES/samples;
  };
  function update(packed,count=packed.length/4){
    const n=Math.min(Math.floor(count),Math.floor(packed.length/4));reserve(n);
    low.set(Infinity,Infinity,Infinity);high.set(-Infinity,-Infinity,-Infinity);
    let live=0;
    for(let i=0;i<n;i++){
      const j=i*4,x=packed[j],y=packed[j+1],z=packed[j+2],r=packed[j+3];
      if(!(r>0) || !Number.isFinite(x+y+z+r))continue;
      const k=live*4;particles.array[k]=x;particles.array[k+1]=y;particles.array[k+2]=z;particles.array[k+3]=r;
      seeds.array[live]=((Math.imul(i+1,2654435761) ^ seed)>>>0)*1.46291808e-9;
      live++;
      const margin=4*r+.065;
      low.x=Math.min(low.x,x-margin);low.y=Math.min(low.y,y-margin);low.z=Math.min(low.z,z-margin);
      high.x=Math.max(high.x,x+margin);high.y=Math.max(high.y,y+margin);high.z=Math.max(high.z,z+margin);
    }
    geo.instanceCount=live;particles.needsUpdate=true;seeds.needsUpdate=true;
    cloud.visible=live>0;surface.visible=live>=3;
    if(!surface.visible)return;
    // A compact C1 kernel on a physical grid. Its maximum contribution per parcel is
    // 32, below 70 even for two overlapping centroids. Isolated slots cannot form rocks.
    const step=Math.max(.046,(high.x-low.x)/(NX-3),(high.y-low.y)/(NY-3),(high.z-low.z)/(NZ-3));
    origin.set(Math.floor(low.x/step)*step,Math.floor(low.y/step)*step,Math.floor(low.z/step)*step);
    worldSize.set(NX*step,NY*step,NZ*step);surfaceUniforms.voxel.value=step;
    surface.position.addVectors(low,high).multiplyScalar(.5);surface.scale.subVectors(high,low);
    field.fill(0);
    const row=NX,plane=NX*NY, data=particles.array;
    let hasDense=false;
    for(let i=0;i<live;i++){
      const j=4*i,gx=(data[j]-origin.x)/step-.5,gy=(data[j+1]-origin.y)/step-.5,gz=(data[j+2]-origin.z)/step-.5;
      const radius=3.7*data[j+3]/step,rsq=radius*radius;
      const x0=Math.max(0,Math.ceil(gx-radius)),x1=Math.min(NX-1,Math.floor(gx+radius));
      const y0=Math.max(0,Math.ceil(gy-radius)),y1=Math.min(NY-1,Math.floor(gy+radius));
      const z0=Math.max(0,Math.ceil(gz-radius)),z1=Math.min(NZ-1,Math.floor(gz+radius));
      for(let z=z0;z<=z1;z++){
        const dz2=(z-gz)*(z-gz),zi=z*plane;
        for(let y=y0;y<=y1;y++){
          const dyz2=dz2+(y-gy)*(y-gy),base=zi+y*row;
          if(dyz2>=rsq)continue;
          for(let x=x0;x<=x1;x++){
            const w=1-((x-gx)*(x-gx)+dyz2)/rsq;
            if(w<=0)continue;
            const k=base+x,v=field[k]+Math.round(32*w*w);
            field[k]=Math.min(255,v);if(v>=70)hasDense=true;
          }
        }
      }
    }
    surface.visible=hasDense;
    if(hasDense)densityField.needsUpdate=true;
  }
  function setGrainSize(mm){
    if(mm!==3 && mm!==6)throw RangeError("La granulometría admite 3 o 6 mm.");
    common.maxDiameter.value=mm*.001;
  }
  function setHopperHeight(mm){
    if(![200,300,900].includes(mm))throw RangeError("Variante de tolva desconocida.");
    common.collar.value=mm*.001;common.clipVessel.value=1;
  }
  function dispose(){
    group.removeFromParent();surface.geometry.dispose();surfaceMat.dispose();geo.dispose();pointMat.dispose();
    densityField.dispose();grainField.dispose();group.clear();
  }
  return {group,update,setGrainSize,setHopperHeight,setVisible(visible){group.visible=Boolean(visible);},dispose};
}
