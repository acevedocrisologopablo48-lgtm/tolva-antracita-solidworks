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

function simulate(settings, send) {
  const p = parameters(settings);
  const riseDifference = 0.900 - p.height / 1000;
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
    y[i] = (lane - 9.5) * 0.136 + 0.02 * (random01(i, 30) - 0.5) + 0.017 * Math.sin(0.7 * wave);
    x[i] = 2.012 + 0.026 * (random01(i, 31) - 0.5);
    z[i] = 3.799 + 0.115 * layer + 0.018 * (random01(i, 32) - 0.5);
    vy[i] = 0.12 * (random01(i, 33) - 0.5);
    vx[i] = -1.59 - 0.32 * random01(i, 34);
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
    const px = x[i], py = y[i], pz = z[i], rad = r[i];
    if (pz - rad < 4.30 && pz > OUTLET - rad) {
      wall(i, 1, 0, 0, -HALF + rad - px, p.wallFriction);
      wall(i, 0, 1, 0, -HALF + rad - py, p.wallFriction);
      wall(i, 0, -1, 0, py - HALF + rad, p.wallFriction);
      if (entered[i] && pz < LIP) wall(i, -1, 0, 0, px - HALF + rad, p.wallFriction);
    }
    if (!entered[i] || z[i] > LIP + rad || z[i] < OUTLET - rad) return;
    const friction = p.wallFriction + p.rollingLoss;

    // Planar end panels. The projection test clips the plane to its actual trapezoid.
    const sx = x[i] < 0 ? -1 : 1;
    const slope = (0.8 + (sx > 0 ? riseDifference : 0)) / 1.125;
    const invLength = 1 / Math.sqrt(1 + slope * slope);
    const nx = -sx * slope * invLength, nz = invLength;
    const distance = (z[i] - OUTLET - slope * (sx * x[i] - 0.600)) * nz;
    if (distance < rad) {
      const t = (sx * (x[i] - nx * distance) - 0.600) / 1.125;
      if (t >= 0 && t <= 1 && Math.abs(y[i]) <= 0.400 + 1.325*t + 1e-8) {
        wall(i, nx, 0, nz, rad - distance, friction);
      }
    }

    // These are the actual ruled side panels; the contact normal follows the continuous loft.
    // S(x,y) = (x, y, 1.600 + t * (0.800 + delta * u)).
    // Project the center to the local tangent, refit that tangent at the projected point,
    // and iterate to obtain the perpendicular foot on the curved sheet.
    const sy = y[i] < 0 ? -1 : 1;
    if (Math.abs(y[i]) < 0.400 - rad) return;
    let qx=x[i], qy=y[i], u=0, t=0, dx=0, dy=0, dz=1, d=0;
    for (let pass=0; pass<4; pass++) {
      t = (sy*qy - 0.400)/1.325;
      if (t < -0.15 || t > 1.15) return;
      const halfWidth = 0.600 + 1.125*t;
      u = 0.5 + qx/(2*halfWidth);
      const surfaceZ = OUTLET + t*(0.800 + riseDifference*u);
      const fx = riseDifference*t/(2*halfWidth);
      const fy = sy/1.325*(0.800 + riseDifference*u - t*riseDifference*qx*1.125/(2*halfWidth*halfWidth));
      dz = 1/Math.sqrt(1 + fx*fx + fy*fy);
      dx = -fx*dz; dy = -fy*dz;
      d = (x[i]-qx)*dx + (y[i]-qy)*dy + (z[i]-surfaceZ)*dz;
      if (pass === 0 && d > rad + 0.015) return;
      const xNext = x[i] - d*dx, yNext = y[i] - d*dy;
      if (Math.abs(xNext-qx) + Math.abs(yNext-qy) < 1e-8) break;
      qx=xNext; qy=yNext;
    }
    if (d < rad && t >= -1e-8 && t <= 1+1e-8 && u >= -1e-8 && u <= 1+1e-8) {
      wall(i, dx, dy, dz, rad-d, friction);
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
        if(!entered[i] && x[i]<=HALF) {entered[i]=1;approach-=m[i];}
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

