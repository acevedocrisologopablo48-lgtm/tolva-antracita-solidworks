import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { createBulkMaterial } from "./bulk-material.js?v=granel3";

const byId = id => document.getElementById(id);
const host = byId("canvasHost");
const status = byId("status");
const variant = byId("variant");
const timeInput = byId("time");
const playButton = byId("play");
const transparent = byId("transparent");
const LOAD_MASS = 1000;
let renderer, camera, controls, scene, model, bulkMaterial;
let frames = [], buffer, duration = 0, activeRequest, revision = 0;
let now = 0, frameIndex = 0, running = false, ready = false, previous = 0;
const meshCache = new Map();
const target = new THREE.Vector3(0, 0, 2.15);
const eye = new THREE.Vector3(1.18, -0.72, 1.2).normalize().multiplyScalar(12);
const spanishMass = new Intl.NumberFormat("es", {useGrouping: "always", maximumFractionDigits: 0});
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
  bulkMaterial = createBulkMaterial(scene, {capacity: 1800, seed: 59});
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
  draw();
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
function updateMass(frame) {
  const loaded = frame?.loaded ?? 0;
  byId("loadedMass").textContent = `${spanishMass.format(loaded)} / ${spanishMass.format(LOAD_MASS)} kg`;
  byId("insideMass").textContent = `${spanishMass.format(frame?.inside ?? 0)} kg`;
  byId("outMass").textContent = `${spanishMass.format(frame?.discharged ?? 0)} kg`;
  const spilled = frame?.spilled ?? 0;
  byId("spill").hidden = spilled < .01;
  byId("spillMass").textContent = `${spanishMass.format(spilled)} kg`;
  byId("phase").textContent = !ready ? "Preparando el ciclo"
    : now === 0 ? "Lista para cargar"
    : now >= duration ? "Fin del ciclo"
    : loaded < LOAD_MASS - .01 ? "Vertido frontal"
    : "Descarga por gravedad";
}

function paintMaterial() {
  if (!frames.length) {
    bulkMaterial.setVisible(false);
    updateMass();
    return;
  }
  while (frameIndex > 0 && frames[frameIndex].t > now) frameIndex--;
  while (frameIndex + 1 < frames.length && frames[frameIndex + 1].t <= now) frameIndex++;
  const frame = frames[frameIndex];
  const next = frames[frameIndex + 1];
  const from = frame.positions;
  const to = next?.positions;
  const fraction = next ? (now - frame.t) / (next.t - frame.t) : 0;
  if (!buffer || buffer.length !== from.length) buffer = new Float32Array(from.length);
  buffer.set(from);
  if (fraction > 0 && to) {
    for (let i = 0; i < from.length; i += 4) {
      if (!from[i+3] || !to[i+3]) continue;
      buffer[i] += (to[i] - from[i]) * fraction;
      buffer[i+1] += (to[i+1] - from[i+1]) * fraction;
      buffer[i+2] += (to[i+2] - from[i+2]) * fraction;
    }
  }
  bulkMaterial.setVisible(true);
  bulkMaterial.update(buffer, buffer.length / 4);
  updateMass(frame);
}

function draw() {
  if (renderer && camera) renderer.render(scene, camera);
}

function setTime(value) {
  now = Math.max(0, Math.min(duration, value));
  timeInput.value = String(now);
  byId("clock").value = duration ? `${spanishTime.format(now)} / ${spanishTime.format(duration)} s` : "0,00 s";
  paintMaterial();
  draw();
}

function loop(timestamp) {
  if (running && ready) {
    if(previous) setTime(now+(timestamp-previous)*.001*Number(byId("speed").value));
    if(now>=duration)setRunning(false);
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
function computeCase(parameters, signal) {
  return new Promise((resolve, reject) => {
    const task = new Worker(new URL("./bulk-worker.js?v=granel3", import.meta.url));
    const result = [];
    const abort = () => finish(() => reject(new DOMException("Carga cancelada", "AbortError")));
    const finish = callback => {
      signal.removeEventListener("abort", abort);
      task.terminate();
      callback();
    };
    signal.addEventListener("abort", abort, {once: true});
    task.onmessage = ({data}) => {
      switch (data.type) {
        case "frame":
          result.push(data);
          break;
        case "done":
          finish(() => {
            if (result.length < 2 || !data.duration) reject(Error("El cálculo no produjo un ciclo válido."));
            else resolve({frames: result, duration: data.duration});
          });
          break;
        case "error":
          finish(() => reject(Error(data.message)));
          break;
      }
    };
    task.onerror = () => finish(() => reject(Error("El cálculo de la descarga se interrumpió.")));
    task.postMessage(parameters);
  });
}

async function loadCase() {
  if (!renderer) return;
  const run = ++revision;
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  const h = variant.value;
  const parameters = {
    height: Number(h),
    diameter: Number(selected("grain")),
    moisture: Number(selected("water")),
    density: Number(selected("density")),
    mass: LOAD_MASS
  };

  ready = false;
  setRunning(false);
  frames = [];
  frameIndex = 0;
  duration = 0;
  playButton.disabled = timeInput.disabled = byId("rewind").disabled = true;
  if (model && model !== meshCache.get(h)) {
    scene.remove(model);
    model = null;
  }
  byId("modelTitle").textContent = variant.selectedOptions[0].textContent;
  bulkMaterial.setGrainSize(parameters.diameter);
  bulkMaterial.setHopperHeight(parameters.height);
  byId("cadDownload").href = "./assets/solidworks/tolva-" + h + ".SLDPRT?v=granel3";
  setTime(0);
  showStatus("Preparando la descarga de 1 tonelada…");

  try {
    const geometry = meshCache.has(h) ? Promise.resolve(meshCache.get(h))
      : fetchChecked("./assets/models/tolva-" + h + ".json?v=granel3", controller.signal)
        .then(r => r.json())
        .then(meshFromFile);
    const simulation = computeCase(parameters, controller.signal);
    const [nextModel, cycle] = await Promise.all([geometry, simulation]);
    if (run !== revision) return;
    if (model) scene.remove(model);
    model = nextModel;
    meshCache.set(h, model);
    scene.add(model);
    setTransparency();
    frames = cycle.frames;
    duration = cycle.duration;
    timeInput.max = String(duration);
    ready = true;
    playButton.disabled = timeInput.disabled = byId("rewind").disabled = false;
    setTime(0);
    showStatus("");
  } catch (error) {
    if (run !== revision || error.name === "AbortError") return;
    controller.abort();
    showStatus(error.message, true);
  }
}

try {
  initScene();
  variant.addEventListener("change",loadCase);
  for(const radio of document.querySelectorAll('input[type=radio]'))radio.addEventListener("change",loadCase);
  byId("retry").addEventListener("click",loadCase);
  byId("fit").addEventListener("click",resetView);
  transparent.addEventListener("change",setTransparency);
  timeInput.addEventListener("input",()=>{setRunning(false);setTime(Number(timeInput.value));});
  byId("rewind").addEventListener("click",()=>{setRunning(false);setTime(0);});
  playButton.addEventListener("click",()=>{if(!running && now>=duration)setTime(0);previous=performance.now();setRunning(!running);});
  document.addEventListener("visibilitychange",()=>{if(document.hidden)setRunning(false);});
  loadCase();requestAnimationFrame(loop);
} catch(error) {
  showStatus("No se pudo iniciar la vista 3D. Comprueba que el navegador tenga WebGL 2 y la aceleración gráfica activada.");
  console.error(error);
}
