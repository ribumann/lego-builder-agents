import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AGENTS, type Brick, type World } from './engine';
import { BrickBatch } from './brick-batch';

const UNIT_Y = 0.7;
export class Workbench {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 900);
  private controls: OrbitControls;
  private scenery = new THREE.Group();
  private model = new THREE.Group();
  private blueprint = new THREE.Group();
  private robots = new THREE.Group();
  private modelBatch?: BrickBatch;
  private blueprintBatch?: BrickBatch;
  private born = new Map<string, number>();
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private cube = new THREE.BoxGeometry(0.94, 0.65, 0.94);
  private stud = new THREE.CylinderGeometry(0.29, 0.29, 0.13, 16);
  private frame = 0;
  private resize: ResizeObserver;
  private exploded = false;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private agentTargets = new Map<string, THREE.Vector3>();
  private onSelect: (brick: Brick) => void;
  private bricks = new Map<string, Brick>();
  private down = { x: 0, y: 0 };
  private cameraTarget = new THREE.Vector3(-1, 3, 0);
  private cameraDistance = 39;
  private renderMetricsDirty = true;
  constructor(host: HTMLElement, onSelect: (brick: Brick) => void) {
    this.onSelect = onSelect;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor('#cce6df');
    this.renderer.domElement.setAttribute('aria-label', 'Interactive 3D brick model. Drag to orbit, scroll to zoom. The Team board provides the same build information in text.');
    this.renderer.domElement.setAttribute('role', 'img');
    host.append(this.renderer.domElement);
    this.camera.position.set(23, 18, 26);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 3, 0);
    this.controls.enableDamping = !this.reduced;
    this.controls.minDistance = 16;
    this.controls.maxDistance = 500;
    this.controls.maxPolarAngle = Math.PI / 2.08;
    this.controls.enablePan = false;
    const ambient = new THREE.HemisphereLight('#fff9e2', '#6c998f', 2.8);
    const sun = new THREE.DirectionalLight('#fff0d6', 3.2);
    sun.position.set(8, 24, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, far: 70 });
    sun.shadow.normalBias = 0.04;
    this.scene.add(ambient, sun, this.scenery, this.model, this.blueprint, this.robots);
    this.resize = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect();
      this.camera.aspect = width / Math.max(height, 1);
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    });
    this.resize.observe(host);
    this.renderer.domElement.addEventListener('pointerdown', e => { this.down = { x: e.clientX, y: e.clientY }; });
    this.renderer.domElement.addEventListener('pointerup', e => {
      if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1,
        -(e.clientY - rect.top) / rect.height * 2 + 1), this.camera);
      const hit = ray.intersectObjects(this.model.children, true)[0];
      const id = hit?.instanceId === undefined ? undefined : hit.object.userData.brickIds?.[hit.instanceId];
      const brick = id && this.bricks.get(id);
      if (brick) this.onSelect(brick);
    });
    this.setWorld('jurassic');
    this.animate();
  }
  private material(color: string, ghost = false) {
    const id = color + ghost;
    if (!this.materials.has(id)) this.materials.set(id, new THREE.MeshStandardMaterial({
      color, roughness: 0.38, metalness: 0.04, transparent: ghost, opacity: ghost ? 0.12 : 1,
      depthWrite: !ghost,
    }));
    return this.materials.get(id)!;
  }
  setWorld(world: World) {
    this.clearGroup(this.scenery, true);
    this.clearGroup(this.robots, true);
    const space = world === 'space';
    const bg = space ? '#152b48' : '#cce6df';
    this.scene.background = new THREE.Color(bg);
    this.scene.fog = new THREE.Fog(bg, 600, 900);
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(17, 18, 0.8, 64),
      this.material(space ? '#536c89' : '#77b798'));
    ground.name = 'build-ground';
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    this.scenery.add(ground);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(26, 0.3, 22), this.material(space ? '#334e6b' : '#a2c89c'));
    plate.name = 'build-plate';
    plate.position.y = -0.2;
    plate.receiveShadow = true;
    this.scenery.add(plate);
    const studs = new THREE.InstancedMesh(this.stud, this.material(space ? '#415c77' : '#91bc8c'), 26 * 22);
    const matrix = new THREE.Matrix4();
    let index = 0;
    for (let x = -13; x < 13; x++) for (let z = -11; z < 11; z++)
      studs.setMatrixAt(index++, matrix.makeTranslation(x + 0.5, 0.02, z + 0.5));
    studs.receiveShadow = true;
    this.scenery.add(studs);
    if (space) {
      const positions = new Float32Array(400 * 3);
      for (let i = 0; i < 400; i++) {
        const r = 65 + (i % 7);
        const a = i * 2.39996;
        const y = 8 + (i * 13 % 55);
        positions.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      this.scenery.add(new THREE.Points(geom, new THREE.PointsMaterial({ color: '#ffffff', size: 0.18 })));
      const planet = new THREE.Mesh(new THREE.SphereGeometry(7, 32, 24), this.material('#a391c9'));
      planet.position.set(-25, 16, -24);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(10, 0.35, 8, 64), this.material('#d5b9ab'));
      ring.rotation.x = Math.PI / 2.5;
      planet.add(ring);
      this.scenery.add(planet);
      for (const x of [-11, 11]) for (const z of [-9, 9]) {
        const light = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 1.8), this.material('#ffc953'));
        light.position.set(x, 0.1, z);
        this.scenery.add(light);
      }
    } else {
      for (const [x, z, scale] of [[-12,-9,1], [10,-8,1.3], [13,4,0.8], [-12,6,0.7]]) {
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 5, 6), this.material('#947454'));
        trunk.position.y = 2.3;
        tree.add(trunk);
        for (let i = 0; i < 5; i++) {
          const leaf = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 1.1), this.material(i % 2 ? '#3d8e6e' : '#4a9e70'));
          leaf.position.set(Math.cos(i * 1.25) * 1.2, 4.5, Math.sin(i * 1.25) * 1.2);
          leaf.rotation.set(0.2, -i * 1.25, 0.2);
          tree.add(leaf);
        }
        tree.position.set(x, 0, z);
        tree.scale.setScalar(scale);
        tree.name = 'site-decoration';
        this.scenery.add(tree);
      }
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(6, 10, 7), this.material('#7a9c92'));
      mountain.position.set(-16, 2, -20);
      mountain.name = 'site-decoration';
      this.scenery.add(mountain);
      const peak = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.8, 7), this.material('#d7ba92'));
      peak.position.set(-16, 6.5, -20);
      peak.name = 'site-decoration';
      this.scenery.add(peak);
    }
    for (const [i, id] of (['build', 'plan', 'frame', 'detail', 'check'] as const).entries()) {
      const robot = new THREE.Group();
      const color = AGENTS[id].color;
      const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.8), this.material(color));
      body.position.y = 0.8;
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.9), this.material(color));
      head.position.y = 1.8;
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.3, 0.08), this.material('#203d52'));
      visor.position.set(0, 1.85, 0.48);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.3, 0.9), this.material('#203d52'));
      foot.position.y = 0.15;
      robot.add(body, head, visor, foot);
      robot.name = id;
      robot.position.set(-8 + i * 4, 0, 8);
      this.robots.add(robot);
    }
    this.resetCamera();
  }
  setBlueprint(bricks: Brick[]) {
    this.modelBatch?.dispose();
    this.modelBatch = undefined;
    this.model.clear();
    this.bricks.clear();
    this.born.clear();
    this.blueprintBatch?.dispose();
    this.blueprint.clear();
    this.blueprintBatch = new BrickBatch(bricks, this.cube, this.stud, color => this.material(color, true), new Map(), true, performance.now());
    this.blueprint.add(this.blueprintBatch.group);
    const largeSite = bricks.some(b => b.x < -13 || b.x + (b.width ?? 1) > 13 || b.z < -11 || b.z + (b.depth ?? 1) > 11);
    const ground = this.scenery.getObjectByName('build-ground');
    const plate = this.scenery.getObjectByName('build-plate');
    const radius = bricks.length ? Math.max(...bricks.map(b => Math.max(Math.abs(b.x), Math.abs(b.x + (b.width ?? 1)), Math.abs(b.z), Math.abs(b.z + (b.depth ?? 1))))) : 13;
    const size = largeSite ? Math.max(2, (radius + 2) / 11) : 1;
    ground?.scale.set(size, 1, size);
    plate?.scale.set(size, 1, size);
    for (const decoration of this.scenery.children)
      if (decoration.name === 'site-decoration') decoration.visible = !largeSite;
    if (bricks.some(b => b.width !== undefined)) {
      const minX = Math.min(...bricks.map(b => b.x)), maxX = Math.max(...bricks.map(b => b.x + (b.width ?? 1) - 1));
      const minY = Math.min(...bricks.map(b => b.y)) * UNIT_Y, maxY = Math.max(...bricks.map(b => b.y + (b.height ?? 1))) * UNIT_Y;
      const minZ = Math.min(...bricks.map(b => b.z)), maxZ = Math.max(...bricks.map(b => b.z + (b.depth ?? 1) - 1));
      this.cameraTarget.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
      this.cameraDistance = Math.max(25, Math.hypot(maxX - minX + 1, maxY - minY, maxZ - minZ + 1) * 1.8);
    } else {
      this.cameraTarget.set(-1, 3, 0);
      this.cameraDistance = 39;
    }
    this.resetCamera();
  }
  showBlueprint(show: boolean) { this.blueprint.visible = show; }
  sync(bricks: Brick[]) {
    const present = new Set(bricks.map(b => b.id));
    if (present.size === this.bricks.size && [...present].every(id => this.bricks.has(id))) return;
    for (const id of this.bricks.keys()) if (!present.has(id)) this.born.delete(id);
    const now = performance.now();
    for (const brick of bricks) {
      if (!this.bricks.has(brick.id)) {
        this.born.set(brick.id, this.reduced ? 0 : now);
        this.agentTargets.set(brick.agent, new THREE.Vector3(brick.x, 0, Math.min(9, brick.z + 5)));
      }
    }
    this.bricks = new Map(bricks.map(b => [b.id, b]));
    this.modelBatch?.dispose();
    this.model.clear();
    this.modelBatch = new BrickBatch(bricks, this.cube, this.stud, color => this.material(color), this.born, false, now);
    this.modelBatch.setExploded(this.exploded, now);
    this.model.add(this.modelBatch.group);
    this.renderMetricsDirty = true;
  }
  explode(value: boolean) { this.exploded = value; this.modelBatch?.setExploded(value, performance.now()); }
  resetCamera() {
    this.camera.position.copy(this.cameraTarget).add(new THREE.Vector3(0.55, 0.35, 0.7).normalize().multiplyScalar(this.cameraDistance));
    this.controls.target.copy(this.cameraTarget);
    this.controls.update();
  }
  private animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    const now = performance.now();
    this.modelBatch?.animate(now);
    for (const robot of this.robots.children) {
      const target = this.agentTargets.get(robot.name);
      if (target) {
        robot.position.lerp(target, this.reduced ? 1 : 0.025);
        robot.rotation.y = Math.sin(now / 1700) * 0.2;
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (this.renderMetricsDirty) {
      const meshes = (this.modelBatch?.group.children ?? []) as THREE.InstancedMesh[];
      const canvas = this.renderer.domElement;
      canvas.dataset.modelBodies = String(meshes.filter((_, i) => i % 2 === 0).reduce((sum, mesh) => sum + mesh.count, 0));
      canvas.dataset.modelStuds = String(meshes.filter((_, i) => i % 2 === 1).reduce((sum, mesh) => sum + mesh.count, 0));
      canvas.dataset.renderCalls = String(this.renderer.info.render.calls);
      canvas.dataset.renderTriangles = String(this.renderer.info.render.triangles);
      this.renderMetricsDirty = false;
    }
  };
  private clearGroup(group: THREE.Group, dispose = false) {
    if (dispose) group.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        if (object.geometry !== this.cube && object.geometry !== this.stud) object.geometry.dispose();
        if (object instanceof THREE.Points) object.material.dispose();
      }
    });
    group.clear();
  }
  dispose() {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.modelBatch?.dispose();
    this.blueprintBatch?.dispose();
    this.cube.dispose();
    this.stud.dispose();
    for (const material of this.materials.values()) material.dispose();
  }
}
