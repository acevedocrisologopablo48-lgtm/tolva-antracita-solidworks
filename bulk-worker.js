/* SI units. Each sphere is a lump of many grains, with a conserved transport mass. */
"use strict";

const COUNT = 1200;
const STEP = 1 / 120;
const DURATION = 8;
const FRAME_STEPS = 6;
const LIP = 3.30;
const OUTLET = 1.60;
const HALF = 1.725;
const GRAVITY = 9.80665;

function random01(i, salt) {
  let a = Math.imul(i + 1, 0x7feb352d) ^ Math.imul(salt, 0x846ca68b);
  a = Math.imul(a ^ (a >>> 16), 0x27d4eb2d);
  return ((a ^ (a >>> 15)) >>> 0) / 4294967296;
}

function parameters(opts) {
  const {height, diameter, moisture, density, mass} = opts || {};
  if (![900, 300, 200].includes(height) || ![3, 6].includes(diameter) ||
      ![5, 9].includes(moisture) || ![1600, 1800].includes(density) || mass !== 1000) {
    throw Error("Seleccione una geometría, granulometría, humedad y densidad válidas para la carga de 1000 kg.");
  }
  // Effective mass-scale assumptions, not measured constitutive properties.
  const wet = (moisture - 5) / 4;
  const fine = 3 / diameter;
  return {
    height, density, mass,
    wallFriction: 0.49 + 0.04 * wet + 0.015 * fine,
    coalFriction: 0.54 + 0.08 * wet,
    rollingLoss: 0.025 + 0.018 * wet,
    cohesion: GRAVITY * (0.05 + 0.18 * wet) * fine * 1700 / density
  };
}

function funnel(height) {
  const signX = [-1, 1, 1, -1], signY = [-1, -1, 1, 1];
  const top = signX.map((x, i) => [x * HALF, signY[i] * HALF, x < 0 ? 2.4 : LIP - height / 1000]);
  const outlet = signX.map((x, i) => [x * 0.6, signY[i] * 0.4, OUTLET]);
  const triangles = [];
  function add(a, b, c) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const magnitude = Math.hypot(nx, ny, nz) * Math.sign(nz);
    nx /= magnitude; ny /= magnitude; nz /= magnitude;
    triangles.push({
      ax: a[0], ay: a[1], az: a[2], ux, uy, vx, vy, det: ux * vy - uy * vx, nx, ny, nz,
      xmin: Math.min(a[0], b[0], c[0]), xmax: Math.max(a[0], b[0], c[0]),
      ymin: Math.min(a[1], b[1], c[1]), ymax: Math.max(a[1], b[1], c[1])
    });
  }
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    if (i === 2) {
      add(top[j], top[i], outlet[i]); add(top[j], outlet[i], outlet[j]);
    } else {
      add(top[i], top[j], outlet[j]); add(top[i], outlet[j], outlet[i]);
    }
  }
  return triangles;
}

function simulate(settings, send) {
  const p = parameters(settings);
  const triangles = funnel(p.height);
  const x = new Float64Array(COUNT), y = new Float64Array(COUNT), z = new Float64Array(COUNT);
  const vx = new Float64Array(COUNT), vy = new Float64Array(COUNT), vz = new Float64Array(COUNT);
  const r = new Float64Array(COUNT), m = new Float64Array(COUNT);
  const release = new Float64Array(COUNT), state = new Uint8Array(COUNT);
  const entered = new Uint8Array(COUNT);
  // state: 0 awaiting release, 1 upstream, 2 discharged and visible, 3 discharged and hidden,
  // 4 spilled and visible, 5 spilled and hidden.
  let weight = 0;
  for (let i = 0; i < COUNT; i++) {
    // Mild parcel polydispersity avoids crystal packing. This diameter is not a grain diameter.
    r[i] = 0.86 + 0.28 * random01(i, 112);
    m[i] = r[i] ** 3;
    weight += m[i];
  }
  let summedMass = 0, maxRadius = 0;
  for (let i = 0; i < COUNT; i++) {
    m[i] = i === COUNT - 1 ? p.mass - summedMass : m[i] / weight * p.mass;
    summedMass += m[i];
    r[i] = Math.cbrt(3 * m[i] / (4 * Math.PI * p.density));
    maxRadius = Math.max(maxRadius, r[i]);
    const lane = i % 20, layer = Math.floor(i / 20) % 3, wave = Math.floor(i / 60);
    release[i] = 0.012 + 0.069 * wave + 0.022 * random01(i, 36);
    x[i] = (lane - 9.5) * 0.136 + 0.02 * (random01(i, 30) - 0.5) + 0.017 * Math.sin(0.7 * wave);
    y[i] = -2.012 + 0.026 * (random01(i, 31) - 0.5);
    z[i] = 3.799 + 0.115 * layer + 0.018 * (random01(i, 32) - 0.5);
    vx[i] = 0.12 * (random01(i, 33) - 0.5);
    vy[i] = 1.59 + 0.32 * random01(i, 34);
    vz[i] = -0.43 - 0.22 * random01(i, 35);
  }

  // Packed spatial grid within a bounding box covering the approach, vessel and outlet.
  const cell = 2 * maxRadius * 1.08;
  const nX = Math.ceil(4.6 / cell), nY = Math.ceil(4.8 / cell), nZ = Math.ceil(3.4 / cell);
  const heads = new Int32Array(nX * nY * nZ), next = new Int32Array(COUNT);
  const gridX = new Int16Array(COUNT), gridY = new Int16Array(COUNT), gridZ = new Int16Array(COUNT);
  let loaded = 0, discharged = 0, spilled = 0, approach = 0;
  const active = new Uint16Array(COUNT);
  let finish = 0;

  function publish(t) {
    const positions = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) {
      if (state[i] === 1 || state[i] === 2 || state[i] === 4) {
        const o = 4 * i;
        positions[o] = x[i]; positions[o + 1] = y[i]; positions[o + 2] = z[i]; positions[o + 3] = r[i];
      }
    }
    send({type:"frame", t, positions, loaded, inside:Math.max(0, loaded-discharged-spilled),
      discharged, spilled, approach:Math.max(0, approach)}, [positions.buffer]);
  }

  function wall(i, nx, ny, nz, penetration, friction) {
    if (penetration <= 0) return;
    x[i] += penetration * nx; y[i] += penetration * ny; z[i] += penetration * nz;
    const closing = vx[i] * nx + vy[i] * ny + vz[i] * nz;
    if (closing >= 0) return;
    // Zero restitution: remove the inward normal velocity; friction opposes tangential slip.
    vx[i] -= closing * nx; vy[i] -= closing * ny; vz[i] -= closing * nz;
    const tang = Math.hypot(vx[i], vy[i], vz[i]);
    if (tang > 1e-9) {
      const loss = Math.min(1, (-closing) * friction / tang);
      vx[i] *= 1 - loss; vy[i] *= 1 - loss; vz[i] *= 1 - loss;
    }
  }

  function contain(i) {
    // The entire curtain originates outside −Y and clears the H beam before reaching the lip.
    // Ignore the front collar on approach. After entry it blocks only below the open edge.
    const rad = r[i];
    if (z[i] - rad < 4.30 && z[i] > OUTLET - rad) {
      wall(i, 1, 0, 0, -HALF + rad - x[i], p.wallFriction);
      wall(i, -1, 0, 0, x[i] - HALF + rad, p.wallFriction);
      wall(i, 0, -1, 0, y[i] - HALF + rad, p.wallFriction);
      if (entered[i] && z[i] < LIP) wall(i, 0, 1, 0, -HALF + rad - y[i], p.wallFriction);
    }
    if (!entered[i] || z[i] > 3.30 + rad || z[i] < OUTLET - rad) return;
    // A signed surface constraint, evaluated at the particle's projected point, is continuous
    // even when one timestep crosses deeply into a panel. CAD seams use the exact CAD triangles.
    for (const panel of triangles) {
      const dx = x[i] - panel.ax, dy = y[i] - panel.ay, dz = z[i] - panel.az;
      const normalDistance = panel.nx * dx + panel.ny * dy + panel.nz * dz;
      if (normalDistance >= rad) continue;
      const qx = x[i] - normalDistance * panel.nx, qy = y[i] - normalDistance * panel.ny;
      if (qx < panel.xmin - 1e-8 || qx > panel.xmax + 1e-8 ||
          qy < panel.ymin - 1e-8 || qy > panel.ymax + 1e-8) continue;
      const qdx = qx - panel.ax, qdy = qy - panel.ay;
      const u = (qdx * panel.vy - qdy * panel.vx) / panel.det;
      const v = (panel.ux * qdy - panel.uy * qdx) / panel.det;
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1.0000001) {
        wall(i, panel.nx, panel.ny, panel.nz, rad - normalDistance, p.wallFriction + p.rollingLoss);
      }
    }
  }

  function pair(i, j) {
    const radii = r[i] + r[j], reach = radii * 1.025;
    const dx = x[i]-x[j], dy=y[i]-y[j], dz=z[i]-z[j], squared = dx*dx+dy*dy+dz*dz;
    if (squared >= reach*reach || squared < 1e-18) return;
    const dist = Math.sqrt(squared), nx=dx/dist, ny=dy/dist, nz=dz/dist, overlap = radii-dist;
    const fi = m[j]/(m[i]+m[j]), fj = 1-fi;
    const dvx=vx[i]-vx[j], dvy=vy[i]-vy[j], dvz=vz[i]-vz[j];
    const rel = dvx*nx+dvy*ny+dvz*nz;
    let compression = 0;
    if (overlap > 0) {
      // Geometric correction does not add rebound velocity to either parcel.
      const corr = overlap * 0.85;
      x[i]+=fi*corr*nx; y[i]+=fi*corr*ny; z[i]+=fi*corr*nz;
      x[j]-=fj*corr*nx; y[j]-=fj*corr*ny; z[j]-=fj*corr*nz;
      compression=Math.max(0,-rel);
    }
    // Short-range attraction is active only on non-approaching pairs, with a cap that
    // prevents numerical overshoot through a contacting pair during a single half-step.
    const adhesion = Math.max(0, Math.min(Math.max(0, rel), p.cohesion * STEP * 0.5 *
      (overlap > 0 ? 1 : Math.max(0, 1 + overlap / (reach-radii)))));
    const normal = compression - adhesion;
    const tx=dvx-rel*nx, ty=dvy-rel*ny, tz=dvz-rel*nz;
    const speed=Math.hypot(tx,ty,tz);
    const tf = speed>1e-9 ? Math.min(1, p.coalFriction*(compression+adhesion)/speed) : 0;
    const jx=normal*nx-tf*tx, jy=normal*ny-tf*ty, jz=normal*nz-tf*tz;
    vx[i]+=fi*jx; vy[i]+=fi*jy; vz[i]+=fi*jz;
    vx[j]-=fj*jx; vy[j]-=fj*jy; vz[j]-=fj*jz;
  }

  function solveContacts() {
    heads.fill(-1);
    for (let k=0;k<finish;k++) {
      const i=active[k];
      const xx=Math.max(0,Math.min(nX-1,Math.floor((x[i]+2.3)/cell)));
      const yy=Math.max(0,Math.min(nY-1,Math.floor((y[i]+2.45)/cell)));
      const zz=Math.max(0,Math.min(nZ-1,Math.floor((z[i]-1.24)/cell)));
      gridX[i]=xx;gridY[i]=yy;gridZ[i]=zz;
      const key=(zz*nY+yy)*nX+xx;
      next[i]=heads[key];heads[key]=i;
    }
    for (let k=0;k<finish;k++) {
      const i=active[k], xx=gridX[i],yy=gridY[i],zz=gridZ[i];
      for(let a=Math.max(0,zz-1);a<=Math.min(nZ-1,zz+1);a++) {
        for(let b=Math.max(0,yy-1);b<=Math.min(nY-1,yy+1);b++) {
          const offset=(a*nY+b)*nX;
          for(let c=Math.max(0,xx-1);c<=Math.min(nX-1,xx+1);c++) {
            for(let j=heads[offset+c];j>=0;j=next[j]) if(j>i) pair(i,j);
          }
        }
      }
    }
    for(let k=0;k<finish;k++) contain(active[k]);
  }

  send({type:"ready",count:COUNT,mass:p.mass,duration:DURATION});
  publish(0);
  for(let step=1;step<=Math.round(DURATION/STEP);step++) {
    const t=step*STEP;
    finish=0;
    for(let i=0;i<COUNT;i++) {
      if(!state[i] && t>=release[i]) {state[i]=1; loaded+=m[i]; approach+=m[i];}
      if(state[i]!==1 && state[i]!==2 && state[i]!==4) continue;
      vz[i]-=GRAVITY*STEP;
      x[i]+=vx[i]*STEP; y[i]+=vy[i]*STEP; z[i]+=vz[i]*STEP;
      if(state[i]===1) {
        if(!entered[i] && y[i]>=-HALF) {entered[i]=1;approach-=m[i];}
        contain(i);
        if(z[i]<=OUTLET) {
          if(entered[i] && Math.abs(x[i])<=0.60001 && Math.abs(y[i])<=0.40001) {
            state[i]=2;discharged+=m[i];
          } else {
            state[i]=4;spilled+=m[i];
            if(!entered[i]) approach-=m[i];
          }
        } else {
          active[finish++]=i;
        }
      } else if(z[i]<1.32-r[i]) {
        state[i]++;
      }
    }
    if(finish) {solveContacts(); solveContacts();}
    if(step%FRAME_STEPS===0) publish(t);
  }
  send({type:"done",duration:DURATION});
}

if (typeof self !== "undefined") {
  self.onmessage = event => {
    try { simulate(event.data, (value, transfer=[]) => self.postMessage(value, transfer)); }
    catch (error) { self.postMessage({type:"error",message:String(error.message || error)}); }
  };
}

