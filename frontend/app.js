// frontend/app.js

// API endpoint base URL for the FastAPI backend
const API_BASE = "http://localhost:8000";

// Three.js scene globals
let scene, camera, renderer, controls;
let points = null;
let currentBox = null;

// Arrays for visualizing facet planes
let facetPlaneMeshes = [];
let islandCenter = new THREE.Vector3();
let lastCfg = null;

// UI element references – sea parameters
const seaAInput = document.getElementById("sea-a");
const seaNaInput = document.getElementById("sea-na");
const seaNbInput = document.getElementById("sea-nb");
const seaNcInput = document.getElementById("sea-nc");

// UI element references – island parameters
const islEnabledInput = document.getElementById("isl-enabled");
const islRadiusInput = document.getElementById("isl-radius");
const islRadiusValue = document.getElementById("isl-radius-value");

// UI element references – facets
const addFacetBtn = document.getElementById("add-facet-btn");
const facetListDiv = document.getElementById("facet-list");

// Other UI references
const applyBtn = document.getElementById("apply-btn");
const yamlView = document.getElementById("yaml-view");

// In-memory representation of facets; each facet has:
// { frame: string, miller: [int,int,int], offset: number, side: string }
let facetData = [];

// ===================== Three.js setup =====================

function initThree() {
  const canvas = document.getElementById("three-canvas");
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050509);

  camera = new THREE.PerspectiveCamera(
    45,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    10000
  );
  camera.position.set(50, 50, 50);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const light = new THREE.DirectionalLight(0xffffff, 1.0);
  light.position.set(1, 1, 1);
  scene.add(light);

  const ambient = new THREE.AmbientLight(0xffffff, 0.3);
  scene.add(ambient);

  window.addEventListener("resize", onWindowResize);
  animate();
}

function onWindowResize() {
  const canvas = renderer.domElement;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// ===================== Backend API helpers =====================

// Fetch current configuration from the FastAPI backend
async function fetchConfig() {
  const res = await fetch(`${API_BASE}/api/config`);
  if (!res.ok) {
    throw new Error(`Failed to fetch config: ${res.status}`);
  }
  return await res.json();
}

// Save updated configuration to the FastAPI backend
async function saveConfig(cfg) {
  const res = await fetch(`${API_BASE}/api/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  });
  if (!res.ok) {
    throw new Error(`Failed to save config: ${res.status}`);
  }
  return await res.json();
}

// Fetch downsampled atom positions and types from backend
async function fetchAtoms() {
  const res = await fetch(`${API_BASE}/api/atoms?max_atoms=20000`);
  if (!res.ok) {
    throw new Error(`Failed to fetch atoms: ${res.status}`);
  }
  return await res.json();
}

// ===================== Facet UI rendering =====================

/**
 * Render facet cards based on facetData array. Each card allows editing
 * Miller indices, offset and side, and supports removal.
 */
function renderFacets() {
  facetListDiv.innerHTML = "";

  if (facetData.length === 0) {
    const p = document.createElement("p");
    p.textContent = "No facets defined. The island will fall back to a sphere.";
    p.style.fontSize = "0.8rem";
    p.style.color = "#aaa";
    facetListDiv.appendChild(p);
    return;
  }

  facetData.forEach((facet, index) => {
    const card = document.createElement("div");
    card.className = "facet-card";

    // Header row: label and remove button
    const header = document.createElement("div");
    header.className = "facet-card-header";
    const labelSpan = document.createElement("span");
    labelSpan.textContent = `Facet ${index + 1} (${facet.frame})`;
    header.appendChild(labelSpan);
    const removeBtn = document.createElement("button");
    removeBtn.className = "facet-remove-btn";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      facetData.splice(index, 1);
      renderFacets();
      updateFacetPlanes();
    });
    header.appendChild(removeBtn);
    card.appendChild(header);

    // Row: Miller indices (h,k,l)
    const rowMiller = document.createElement("div");
    rowMiller.className = "facet-row";
    const labMiller = document.createElement("label");
    labMiller.textContent = "Miller (h,k,l):";
    rowMiller.appendChild(labMiller);
    const hInput = document.createElement("input");
    hInput.type = "number";
    hInput.value = facet.miller[0];
    hInput.addEventListener("input", () => {
      facet.miller[0] = parseInt(hInput.value) || 0;
      updateFacetPlanes();
    });
    rowMiller.appendChild(hInput);
    const kInput = document.createElement("input");
    kInput.type = "number";
    kInput.value = facet.miller[1];
    kInput.addEventListener("input", () => {
      facet.miller[1] = parseInt(kInput.value) || 0;
      updateFacetPlanes();
    });
    rowMiller.appendChild(kInput);
    const lInput = document.createElement("input");
    lInput.type = "number";
    lInput.value = facet.miller[2];
    lInput.addEventListener("input", () => {
      facet.miller[2] = parseInt(lInput.value) || 0;
      updateFacetPlanes();
    });
    rowMiller.appendChild(lInput);
    card.appendChild(rowMiller);

    // Row: offset distance along plane normal
    const rowOffset = document.createElement("div");
    rowOffset.className = "facet-row";
    const labOffset = document.createElement("label");
    labOffset.textContent = "Offset (Å):";
    rowOffset.appendChild(labOffset);
    const offsetInput = document.createElement("input");
    offsetInput.type = "number";
    offsetInput.step = "0.1";
    offsetInput.value = facet.offset;
    offsetInput.addEventListener("input", () => {
      facet.offset = parseFloat(offsetInput.value) || 0.0;
      updateFacetPlanes();
    });
    rowOffset.appendChild(offsetInput);
    card.appendChild(rowOffset);

    // Row: side (inside/outside)
    const rowSide = document.createElement("div");
    rowSide.className = "facet-row";
    const labSide = document.createElement("label");
    labSide.textContent = "Side:";
    rowSide.appendChild(labSide);
    const sideSelect = document.createElement("select");
    ["inside", "outside"].forEach((optVal) => {
      const opt = document.createElement("option");
      opt.value = optVal;
      opt.textContent = optVal;
      if (facet.side === optVal) {
        opt.selected = true;
      }
      sideSelect.appendChild(opt);
    });
    sideSelect.addEventListener("change", () => {
      facet.side = sideSelect.value;
    });
    rowSide.appendChild(sideSelect);
    card.appendChild(rowSide);

    facetListDiv.appendChild(card);
  });
}

// ===================== Config ↔ UI sync functions =====================

/**
 * Populate UI controls based on backend config. Also sets up facetData
 * and calculates island center for plane positioning.
 */
function populateControls(cfg) {
  lastCfg = cfg;

  // Sea fields
  seaAInput.value = cfg.sea.lattice_constant;
  seaNaInput.value = cfg.sea.supercell[0];
  seaNbInput.value = cfg.sea.supercell[1];
  seaNcInput.value = cfg.sea.supercell[2];

  // Island basic settings
  islEnabledInput.checked = cfg.island.enabled;
  islRadiusInput.value = cfg.island.radius;
  islRadiusValue.textContent = cfg.island.radius.toFixed(2);

  // Determine island center: if [0,0,0] treat as auto center in the sea cell
  const a = cfg.sea.lattice_constant;
  const [na, nb, nc] = cfg.sea.supercell;
  const c = cfg.island.center;
  if (Math.abs(c[0]) < 1e-8 && Math.abs(c[1]) < 1e-8 && Math.abs(c[2]) < 1e-8) {
    islandCenter.set((na * a) / 2, (nb * a) / 2, (nc * a) / 2);
  } else {
    islandCenter.set(c[0], c[1], c[2]);
  }

  // Copy facets to facetData; default to one facet if none defined
  if (cfg.island.facets && cfg.island.facets.length > 0) {
    facetData = cfg.island.facets.map((f) => ({
      frame: f.frame || "sea",
      miller: [f.miller[0] || 1, f.miller[1] || 1, f.miller[2] || 1],
      offset: f.offset ?? cfg.island.radius,
      side: f.side || "inside",
    }));
  } else {
    // Provide a single default facet with offset equal to radius as a hint
    facetData = [
      {
        frame: "sea",
        miller: [1, 1, 1],
        offset: cfg.island.radius,
        side: "inside",
      },
    ];
  }

  // Render facet list and update plane visuals
  renderFacets();
  updateFacetPlanes();
}

/**
 * Convert current UI values to a config object for saving. We keep the
 * existing island.center from backend to preserve auto-center logic.
 */
function readControlsToCfg(currentCfg) {
  // Sea properties
  const sea = {
    lattice_constant: parseFloat(seaAInput.value),
    supercell: [
      parseInt(seaNaInput.value),
      parseInt(seaNbInput.value),
      parseInt(seaNcInput.value),
    ],
  };

  // Preserve island center from backend config; backend will auto-center if [0,0,0]
  const center = currentCfg.island.center || [0.0, 0.0, 0.0];

  // Island configuration
  const island = {
    enabled: islEnabledInput.checked,
    center: center,
    radius: parseFloat(islRadiusInput.value),
    facets: facetData.map((f) => ({
      frame: f.frame || "sea",
      miller: [f.miller[0] || 0, f.miller[1] || 0, f.miller[2] || 0],
      offset: f.offset ?? 0.0,
      side: f.side || "inside",
    })),
  };

  return { sea, island };
}

/**
 * Serialize a config object back to YAML for display. This is a simple
 * YAML-like serializer for demonstration purposes; it isn't guaranteed
 * to emit valid YAML for all cases.
 */
function cfgToYamlText(cfg) {
  const lines = [];
  lines.push("sea:");
  lines.push(`  lattice_constant: ${cfg.sea.lattice_constant}`);
  lines.push(
    `  supercell: [${cfg.sea.supercell.join(", ")}]`
  );
  lines.push("");
  lines.push("island:");
  lines.push(`  enabled: ${cfg.island.enabled ? "true" : "false"}`);
  lines.push(
    `  center: [${cfg.island.center.join(", ")}]`
  );
  lines.push(`  radius: ${cfg.island.radius}`);
  if (cfg.island.facets && cfg.island.facets.length > 0) {
    lines.push("  facets:");
    cfg.island.facets.forEach((f) => {
      lines.push(`    - frame: ${f.frame}`);
      lines.push(
        `      miller: [${f.miller.join(", ")}]`
      );
      lines.push(`      offset: ${f.offset}`);
      lines.push(`      side: ${f.side}`);
    });
  }
  return lines.join("\n");
}

// ===================== Atom cloud rendering =====================

/**
 * Create a THREE.Points object from atoms array (positions and types). Atoms
 * with type 0 are drawn white (sea) and type 1 drawn orange (island).
 */
function createPoints(atoms) {
  const n = atoms.length;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);

  const colorSea = new THREE.Color(0xffffff);
  const colorIsland = new THREE.Color(0xffaa33);

  for (let i = 0; i < n; i++) {
    const a = atoms[i];
    positions[3 * i] = a.x;
    positions[3 * i + 1] = a.y;
    positions[3 * i + 2] = a.z;
    const col = a.type === 1 ? colorIsland : colorSea;
    colors[3 * i] = col.r;
    colors[3 * i + 1] = col.g;
    colors[3 * i + 2] = col.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({ size: 0.7, vertexColors: true });
  return new THREE.Points(geo, mat);
}

/**
 * Position the camera so the entire box is visible and centre the orbit controls.
 */
function updateCameraToBox(box) {
  if (!box) return;
  const sizeX = box.x[1] - box.x[0];
  const sizeY = box.y[1] - box.y[0];
  const sizeZ = box.z[1] - box.z[0];
  const maxSize = Math.max(sizeX, sizeY, sizeZ);
  const center = new THREE.Vector3(
    (box.x[0] + box.x[1]) / 2,
    (box.y[0] + box.y[1]) / 2,
    (box.z[0] + box.z[1]) / 2
  );
  camera.position.copy(center.clone().add(new THREE.Vector3(maxSize, maxSize, maxSize)));
  camera.lookAt(center);
  controls.target.copy(center);
}

// ===================== Facet plane rendering =====================

/**
 * Remove all current facet plane meshes from the scene and dispose of geometry/material.
 */
function clearFacetPlanes() {
  facetPlaneMeshes.forEach((mesh) => {
    scene.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) mesh.material.dispose();
  });
  facetPlaneMeshes = [];
}

/**
 * Update or create plane meshes for each facet. Called when facets change
 * or islandCenter changes or the scene box changes.
 */
function updateFacetPlanes() {
  if (!lastCfg) return;
  clearFacetPlanes();
  if (!facetData || facetData.length === 0) return;
  if (!currentBox) return;
  // Determine size for plane geometry based on the bounding box
  const sizeX = currentBox.x[1] - currentBox.x[0];
  const sizeY = currentBox.y[1] - currentBox.y[0];
  const sizeZ = currentBox.z[1] - currentBox.z[0];
  const maxSize = Math.max(sizeX, sizeY, sizeZ) || 10;
  const planeSize = maxSize * 2.0;
  facetData.forEach((facet) => {
    const [h, k, l] = facet.miller;
    const n = new THREE.Vector3(h, k, l);
    if (n.length() === 0) return;
    const nHat = n.clone().normalize();
    const offset = facet.offset ?? lastCfg.island.radius;
    const geo = new THREE.PlaneGeometry(planeSize, planeSize);
    const mat = new THREE.MeshBasicMaterial({
      color: facet.side === "inside" ? 0x00ff88 : 0xff4488,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    // orient plane to face nHat: default plane normal is +Z
    const defaultNormal = new THREE.Vector3(0, 0, 1);
    const quat = new THREE.Quaternion().setFromUnitVectors(defaultNormal, nHat);
    mesh.quaternion.copy(quat);
    // position plane: islandCenter + nHat * offset
    const pos = islandCenter.clone().add(nHat.clone().multiplyScalar(offset));
    mesh.position.copy(pos);
    scene.add(mesh);
    facetPlaneMeshes.push(mesh);
  });
}

// ===================== Scene refresh =====================

/**
 * Refresh the atom cloud and update facet planes. Called after config change.
 */
async function refreshScene() {
  const atomData = await fetchAtoms();
  const { atoms, box } = atomData;
  currentBox = box;
  // Remove existing points
  if (points) {
    scene.remove(points);
    points.geometry.dispose();
    points.material.dispose();
    points = null;
  }
  // Create new points and add to scene
  points = createPoints(atoms);
  scene.add(points);
  updateCameraToBox(box);
  // Planes depend on islandCenter and box; update them
  updateFacetPlanes();
}

// ===================== Main initialization =====================

async function main() {
  initThree();
  // Load initial config and populate UI
  const cfg = await fetchConfig();
  populateControls(cfg);
  yamlView.textContent = cfgToYamlText(cfg);
  await refreshScene();

  // Update slider label when radius slider moves
  islRadiusInput.addEventListener("input", () => {
    islRadiusValue.textContent = parseFloat(islRadiusInput.value).toFixed(2);
  });

  // Add new facet when Add Facet button clicked
  addFacetBtn.addEventListener("click", () => {
    facetData.push({
      frame: "sea",
      miller: [1, 1, 1],
      offset: parseFloat(islRadiusInput.value) || 8.0,
      side: "inside",
    });
    renderFacets();
    updateFacetPlanes();
  });

  // Apply changes: read UI, save config to backend, reload config and scene
  applyBtn.addEventListener("click", async () => {
    // get latest config to maintain island.center
    const currentCfg = await fetchConfig();
    const newCfg = readControlsToCfg(currentCfg);
    const saved = await saveConfig(newCfg);
    lastCfg = saved;
    yamlView.textContent = cfgToYamlText(saved);
    populateControls(saved);
    await refreshScene();
  });
}

main().catch((err) => console.error(err));
