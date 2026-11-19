import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";

const byId = id => document.getElementById(id);
const host = byId("canvasHost");
const status = byId("status");
const variant = byId("variant");
const timeInput = byId("time");
const playButton = byId("play");
const markers = byId("markers");
const transparent = byId("transparent");
const TOTAL_TIME = 3;
const CAPACITY = 240;
let renderer, camera, controls, scene, model;
let markerPoints, actualGrains, trails, markPositions, tailPositions;
let tracks = [], activeRequest, revision = 0;
let now = 0, running = false, ready = false, previous = 0;
const meshCache = new Map();
const dataCache = new Map();
const dim = new THREE.Vector2();
const matrix = new THREE.Matrix4();
const target = new THREE.Vector3(0, 0, 2.15);
const eye = new THREE.Vector3(0.72, -1.18, 0.82).normalize().multiplyScalar(12);
const spanishTime = new Intl.NumberFormat("es", {minimumFractionDigits:2, maximumFractionDigits:2});

function showStatus(message, retry = false) {
  status.hidden = !message;
  byId("statusText").textContent = message;
  byId("retry").hidden = !retry;
}
function setRunning(value) {
  running = value;
  byId("playGlyph").classList.toggle("pause", value);
  byId("playLabel").textContent = value ? "Pausar" : "Reproducir";
}
function initScene() {
  scene = new THREE.Scene();
  renderer = new THREE.WebGLRenderer({antialias:true, alpha:true, powerPreference:"high-performance"});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0xffffff, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-label", "Modelo tridimensional. Arrastra para girar y utiliza la rueda para acercar.");
  canvas.addEventListener("webglcontextlost", e => {
    e.preventDefault();
    ready=false; setRunning(false); playButton.disabled=true;
    showStatus("La vista 3D perdió la conexión gráfica. Recarga la página para recuperarla.");
  });
  camera = new THREE.OrthographicCamera(-4,4,4,-4,.02,100);
  camera.up.set(0,0,1);
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.minZoom = .22; controls.maxZoom = 90;
  controls.screenSpacePanning = true;
  controls.addEventListener("change", draw);
  scene.add(new THREE.HemisphereLight(0xffffff,0xc1cbd2,1.75));
  const key = new THREE.DirectionalLight(0xffffff,2.0);
  key.position.set(-4,-6,9); scene.add(key);
  const fill = new THREE.DirectionalLight(0xf0f7ff,.7);
  fill.position.set(3,4,6); scene.add(fill);
  createGrains();
  new ResizeObserver(resize).observe(host);
  resetView(); resize();
}
function resetView() {
  controls.target.copy(target);
  camera.position.copy(target).add(eye);
  camera.zoom=1;
  camera.updateProjectionMatrix(); controls.update(); draw();
}
function resize() {
  const width=host.clientWidth, height=host.clientHeight;
  if (!width || !height) return;
  const ratio=width/height, vertical=Math.max(6.7,6.5/ratio);
  camera.left=-vertical*ratio/2;camera.right=-camera.left;
  camera.top=vertical/2;camera.bottom=-camera.top;
  camera.updateProjectionMatrix();
  renderer.setSize(width,height,false);
  renderer.getDrawingBufferSize(dim);
  draw();
}
function createGrains() {
  markPositions=new Float32Array(CAPACITY*3);
  tailPositions=new Float32Array(CAPACITY*6);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.BufferAttribute(markPositions,3).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0,0);
  const material=new THREE.ShaderMaterial({
    uniforms:{pixels:{value:6}}, transparent:true,depthTest:false,depthWrite:false,
    vertexShader:"uniform float pixels; void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_PointSize=pixels;}",
    fragmentShader:"void main(){float r=length(gl_PointCoord-vec2(0.5));if(r>0.5)discard;vec3 color=mix(vec3(1.0,.733,.149),vec3(.251,.157,.024),smoothstep(.32,.44,r));gl_FragColor=vec4(color,1.0-smoothstep(.44,.51,r));}"
  });
  markerPoints=new THREE.Points(geometry,material);
  markerPoints.frustumCulled=false;markerPoints.renderOrder=5;scene.add(markerPoints);
  const lines=new THREE.BufferGeometry();
  lines.setAttribute("position",new THREE.BufferAttribute(tailPositions,3).setUsage(THREE.DynamicDrawUsage));
  lines.setDrawRange(0,0);
  trails=new THREE.LineSegments(lines,new THREE.LineBasicMaterial({color:0xdc8b0b,transparent:true,opacity:.8,depthTest:false,depthWrite:false}));
  trails.frustumCulled=false;trails.renderOrder=4;scene.add(trails);
  actualGrains=new THREE.InstancedMesh(new THREE.SphereGeometry(1,10,8),new THREE.MeshPhongMaterial({color:0x383c40}),CAPACITY);
  actualGrains.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  actualGrains.count=0;actualGrains.frustumCulled=false;scene.add(actualGrains);
}
function meshFromFile(file) {
  if (!Array.isArray(file.bodies) || !file.bodies.length) throw Error("Archivo de geometría vacío.");
  const group=new THREE.Group();
  for (const body of file.bodies) {
    if (!body.positions?.length || body.positions.length%9) throw Error("Malla incompleta.");
    const geo=new THREE.BufferGeometry();
    geo.setAttribute("position",new THREE.Float32BufferAttribute(body.positions,3));
    if (body.normals?.length === body.positions.length) geo.setAttribute("normal",new THREE.Float32BufferAttribute(body.normals,3));
    else geo.computeVertexNormals();
    const rgb=body.color ?? [.42,.47,.5], scale=rgb.some(v=>v>1)?255:1;
    const color=new THREE.Color().setRGB(rgb[0]/scale,rgb[1]/scale,rgb[2]/scale,THREE.SRGBColorSpace);
    const mat=new THREE.MeshPhongMaterial({color,specular:0x30373c,shininess:24,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
    const mesh=new THREE.Mesh(geo,mat);mesh.name=body.name;
    mesh.userData.plate=/^(Embudo|Collar|Aler[oó]n)\b/i.test(body.name);
    group.add(mesh);
    if (body.edges?.length) {
      const borderGeo=new THREE.BufferGeometry();
      borderGeo.setAttribute("position",new THREE.Float32BufferAttribute(body.edges,3));
      const line=new THREE.LineSegments(borderGeo,new THREE.LineBasicMaterial({color:0x202e36}));
      line.userData.plate=mesh.userData.plate;group.add(line);
    }
  }
  return group;
}
function setTransparency() {
  if (!model) return;
  for (const item of model.children) {
    if (!item.userData.plate) continue;
    const enabled=transparent.checked;
    item.material.transparent=enabled;
    item.material.opacity=enabled?(item.isMesh?.21:.5):1;
    item.material.depthWrite=!enabled;
    if (item.isMesh) item.material.side=enabled?THREE.DoubleSide:THREE.FrontSide;
    item.material.needsUpdate=true;
  }
  draw();
}
function parseTracks(csv) {
  const rows=csv.trim().split(/\r?\n/);
  if (rows.shift().replace(/^\uFEFF/,"")!=="t_s,id,x_mm,y_mm,z_mm,d_mm,estado") throw Error("Formato de trayectoria desconocido.");
  const byGrain=new Map();
  for (const line of rows) {
    const values=line.split(",").map(Number);
    if (values.length!==7 || !values.every(Number.isFinite)) throw Error("Trayectoria incompleta.");
    const [t,id,x,y,z,d,state]=values;
    if (!byGrain.has(id)) byGrain.set(id,[]);
    byGrain.get(id).push({t,x:x*.001,y:y*.001,z:z*.001,r:d*.0005,state});
  }
  if (byGrain.size!==CAPACITY) throw Error("El caso no contiene los 240 granos.");
  return Array.from(byGrain.values(),a=>a.sort((x,y)=>x.t-y.t));
}
function positionAt(a,t) {
  let lo=0, hi=a.length-1;
  while (lo<hi) {
    const mid=(lo+hi+1)>>1;
    if (a[mid].t<=t) lo=mid; else hi=mid-1;
  }
  const p=a[lo], q=a[lo+1];
  if (!q || t<=p.t) return p;
  const f=(t-p.t)/(q.t-p.t);
  return {x:p.x+f*(q.x-p.x),y:p.y+f*(q.y-p.y),z:p.z+f*(q.z-p.z),r:p.r,state:p.state};
}
function paintParticles() {
  if (!markerPoints) return;
  let visible=0, exited=0;
  for (const samples of tracks) {
    if (now<samples[0].t) continue;
    const p=positionAt(samples,now);
    if (p.state) { if(p.state===1)exited++; continue; }
    const i=visible++;
    markPositions.set([p.x,p.y,p.z],3*i);
    const old=positionAt(samples,Math.max(0,now-.085));
    tailPositions.set([old.x,old.y,old.z,p.x,p.y,p.z],6*i);
    matrix.makeScale(p.r,p.r,p.r);matrix.setPosition(p.x,p.y,p.z);actualGrains.setMatrixAt(i,matrix);
  }
  actualGrains.count=visible;actualGrains.instanceMatrix.needsUpdate=true;
  actualGrains.visible=!markers.checked;
  for(const [obj,count] of [[markerPoints,visible],[trails,2*visible]]){
    obj.geometry.attributes.position.needsUpdate=true;obj.geometry.setDrawRange(0,count);obj.visible=markers.checked;
  }
  byId("counter").textContent=ready?exited+" / "+CAPACITY+" granos descargados":"— / 240 granos descargados";
}
function draw() {
  if (!renderer || !camera || !markerPoints) return;
  markerPoints.material.uniforms.pixels.value=6*renderer.getPixelRatio();
  renderer.render(scene,camera);
}
function setTime(value) {
  now=Math.max(0,Math.min(TOTAL_TIME,value));
  timeInput.value=String(now);
  byId("clock").value=spanishTime.format(now)+" / 3,00 s";
  paintParticles();draw();
}
function loop(timestamp) {
  if (running && ready) {
    if(previous) setTime(now+(timestamp-previous)*.001*Number(byId("speed").value));
    if(now>=TOTAL_TIME)setRunning(false);
  }
  previous=timestamp;
  requestAnimationFrame(loop);
}
async function fetchChecked(url,signal) {
  const response=await fetch(url,{signal});
  if(!response.ok) throw Error("No se pudo abrir "+url.split("/").pop()+" (HTTP "+response.status+").");
  return response;
}
function selected(name) {return document.querySelector('input[name="'+name+'"]:checked').value;}
async function loadCase() {
  if (!renderer) return;
  const run=++revision;
  activeRequest?.abort();
  const controller=new AbortController(); activeRequest=controller;
  const signal=controller.signal, h=variant.value;
  const id="P"+h+"_D"+selected("grain")+"_H"+selected("water")+"_R"+selected("density");
  ready=false;setRunning(false);tracks=[];
  playButton.disabled=timeInput.disabled=byId("rewind").disabled=true;
  if (model && model!==meshCache.get(h)) {scene.remove(model);model=null;}
  byId("modelTitle").textContent=variant.selectedOptions[0].textContent;
  byId("cadDownload").href="./assets/solidworks/tolva-"+h+".SLDPRT";
  setTime(0);showStatus("Cargando modelo y simulación…");
  try {
    const [source,points]=await Promise.all([
      meshCache.has(h)?null:fetchChecked("./assets/models/tolva-"+h+".json",signal).then(r=>r.json()),
      dataCache.has(id)?dataCache.get(id):fetchChecked("./assets/data/"+id+".csv",signal).then(r=>r.text()).then(parseTracks)
    ]);
    if(run!==revision)return;
    if(!meshCache.has(h))meshCache.set(h,meshFromFile(source));
    if(model)scene.remove(model);
    model=meshCache.get(h);scene.add(model);setTransparency();
    tracks=points;dataCache.set(id,points);ready=true;
    playButton.disabled=timeInput.disabled=byId("rewind").disabled=false;
    setTime(0);showStatus("");
  } catch(error) {
    if(run!==revision || error.name==="AbortError")return;
    showStatus("Error de carga. "+error.message,true);
  }
}
try {
  initScene();
  variant.addEventListener("change",loadCase);
  for(const radio of document.querySelectorAll('input[type=radio]'))radio.addEventListener("change",loadCase);
  byId("retry").addEventListener("click",loadCase);
  byId("fit").addEventListener("click",resetView);
  transparent.addEventListener("change",setTransparency);
  markers.addEventListener("change",()=>{paintParticles();draw();});
  timeInput.addEventListener("input",()=>{setRunning(false);setTime(Number(timeInput.value));});
  byId("rewind").addEventListener("click",()=>{setRunning(false);setTime(0);});
  playButton.addEventListener("click",()=>{if(!running && now>=TOTAL_TIME)setTime(0);previous=performance.now();setRunning(!running);});
  document.addEventListener("visibilitychange",()=>{if(document.hidden)setRunning(false);});
  loadCase();requestAnimationFrame(loop);
} catch(error) {
  showStatus("No se pudo iniciar la vista 3D. Comprueba que el navegador tenga WebGL 2 y la aceleración gráfica activada.");
  console.error(error);
}
