import { store } from '../store';
import { h } from '../ui/dom';
import { slider, segmented } from '../ui/widgets';
import * as THREE from 'three';

type Surface = 'wall' | 'floor' | 'both';

export function renderPreviewPage(): HTMLElement {
  const s = store.get();
  if (!s.result) {
    return h(
      'div',
      { class: 'panel' },
      h('h2', {}, '④ PBR 实时铺贴预览'),
      h('p', { class: 'hint' }, '请先完成纹理合成与贴图烘焙。')
    );
  }

  const host = h('div', {
    class: 'canvas-stage',
    style: 'min-height:70vh; padding:0; display:block'
  });

  // —— Three 场景 ——
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  host.append(renderer.domElement);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14181f);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(3.2, 2.6, 4.2);
  camera.lookAt(0, 0.8, 0);

  function makeTexture(buf: import('../core/image').ImageBuffer, srgb: boolean): THREE.DataTexture {
    const tex = new THREE.DataTexture(
      new Uint8ClampedArray(buf.data),
      buf.width,
      buf.height,
      THREE.RGBAFormat
    );
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    return tex;
  }

  const r = store.get().result!;
  const map = makeTexture(r.color, true);
  const normalMap = makeTexture(r.normal, false);
  const roughMap = makeTexture(r.roughness, false);

  const material = new THREE.MeshPhysicalMaterial({
    map,
    normalMap,
    roughnessMap: roughMap,
    roughness: 1.0,
    metalness: 0.0,
    clearcoat: store.get().pbr.clearcoat,
    clearcoatRoughness: 0.18,
    normalScale: new THREE.Vector2(store.get().pbr.normalStrength, store.get().pbr.normalStrength)
  });

  // 墙
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.4, 1, 1), material);
  wall.position.set(0, 1.7, -2);
  wall.receiveShadow = true;
  scene.add(wall);

  // 地
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  scene.add(floor);

  // 砖缝几何体（细网格线框，靠 repeat 体现）
  const groutMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.9 });
  const baseboard = new THREE.Mesh(new THREE.BoxGeometry(6.02, 0.08, 0.06), groutMat);
  baseboard.position.set(0, 0.04, -1.97);
  scene.add(baseboard);

  // —— 灯光 ——
  const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x2a2620, 0.55);
  scene.add(hemi);

  const keyLight = new THREE.DirectionalLight(0xfff2dd, 2.2);
  keyLight.position.set(3.5, 5, 3);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 20;
  keyLight.shadow.camera.left = -5;
  keyLight.shadow.camera.right = 5;
  keyLight.shadow.camera.top = 5;
  keyLight.shadow.camera.bottom = -5;
  scene.add(keyLight);

  const fillLight = new THREE.PointLight(0x9fc4ff, 0.8, 12);
  fillLight.position.set(-3, 2.2, 2);
  scene.add(fillLight);

  // —— 简易轨道控制（自研，避免额外依赖） ——
  let theta = Math.atan2(camera.position.x, camera.position.z);
  let phi = 0.9;
  let radius = 5.4;
  let dragging = false;
  let lx = 0;
  let ly = 0;

  function updateCamera(): void {
    camera.position.x = radius * Math.sin(phi) * Math.sin(theta);
    camera.position.z = radius * Math.sin(phi) * Math.cos(theta);
    camera.position.y = radius * Math.cos(phi);
    camera.lookAt(0, 0.9, 0);
  }
  updateCamera();

  renderer.domElement.addEventListener('pointerdown', (ev) => {
    dragging = true;
    lx = ev.clientX;
    ly = ev.clientY;
    renderer.domElement.setPointerCapture(ev.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    theta -= (ev.clientX - lx) * 0.006;
    phi = Math.min(1.45, Math.max(0.25, phi - (ev.clientY - ly) * 0.006));
    lx = ev.clientX;
    ly = ev.clientY;
    updateCamera();
  });
  const end = (): void => {
    dragging = false;
  };
  renderer.domElement.addEventListener('pointerup', end);
  renderer.domElement.addEventListener('pointercancel', end);
  renderer.domElement.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      radius = Math.min(10, Math.max(2.2, radius + ev.deltaY * 0.004));
      updateCamera();
    },
    { passive: false }
  );

  // —— 尺寸自适应 ——
  function resize(): void {
    const w = host.clientWidth;
    const hgt = host.clientHeight;
    if (w === 0 || hgt === 0) return;
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  requestAnimationFrame(resize);

  let raf = 0;
  const loop = (): void => {
    raf = requestAnimationFrame(loop);
    renderer.render(scene, camera);
  };
  loop();

  function setRepeat(n: number): void {
    for (const t of [map, normalMap, roughMap]) {
      t.repeat.set(n, n);
    }
  }
  setRepeat(4);

  function setSurface(kind: Surface): void {
    wall.visible = kind !== 'floor';
    floor.visible = kind !== 'wall';
  }

  // —— 控制条 ——
  const toolbar = h(
    'div',
    { class: 'preview-toolbar panel', style: 'margin-bottom:12px' },
    h('label', {}, '铺贴面'),
    segmented(
      [
        { value: 'both', label: '墙+地' },
        { value: 'wall', label: '墙面' },
        { value: 'floor', label: '地面' }
      ] as { value: Surface; label: string }[],
      'both',
      (v) => setSurface(v)
    )
  );

  const repeatSlider = slider('平铺数量 repeat', 4, 1, 16, 1, (v) => setRepeat(v), (v) => String(v));
  const lightSlider = slider('主灯强度', 2.2, 0, 5, 0.1, (v) => (keyLight.intensity = v), (v) => v.toFixed(1));
  const fillSlider = slider('补光强度', 0.8, 0, 3, 0.1, (v) => (fillLight.intensity = v), (v) => v.toFixed(1));
  const exposureSlider = slider('曝光', 1.0, 0.3, 2, 0.05, (v) => (renderer.toneMappingExposure = v));
  const clearcoatSlider = slider('釉面清漆（实时）', s.pbr.clearcoat, 0, 1, 0.02, (v) => {
    material.clearcoat = v;
    store.patchPBR({ clearcoat: v });
  });

  const side = h(
    'div',
    { class: 'panel' },
    h('h2', {}, '④ PBR 实时铺贴预览'),
    repeatSlider,
    lightSlider,
    fillSlider,
    exposureSlider,
    clearcoatSlider,
    h(
      'p',
      { class: 'hint' },
      'MeshPhysicalMaterial + ACES 色调映射，主灯投影。鼠标拖拽旋转、滚轮缩放。所有贴图 RepeatWrapping，任意 repeat 都无缝。'
    )
  );

  const root = h('div', { class: 'layout-2col' }, side, h('div', {}, toolbar, host));

  // 离开页面时由 main.ts 调用，释放 WebGL 资源
  const cleanup = (): void => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    renderer.dispose();
    map.dispose();
    normalMap.dispose();
    roughMap.dispose();
    material.dispose();
    wall.geometry.dispose();
    floor.geometry.dispose();
  };
  (root as HTMLElement & { __cleanup?: () => void }).__cleanup = cleanup;

  return root;
}
