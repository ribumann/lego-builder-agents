import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AGENTS, type Brick, type World } from './engine';

const UNIT_Y = 0.7;
export class Workbench {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.1, 250);
  private controls: OrbitControls;
  private scenery = new THREE.Group();
  private model = new THREE.Group();
  private blueprint = new THREE.Group();
  private robots = new THREE.Group();
  private meshes = new Map<string, THREE.Group>();
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
    this.controls.maxDistance = 150;
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
      const brick = hit && this.bricks.get(hit.object.parent?.userData.id);
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
  private brickMesh(brick: Brick, ghost = false) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.cube, this.material(brick.color, ghost));
    const width = brick.width ?? 1, height = brick.height ?? 1, depth = brick.depth ?? 1;
    const bodyHeight = 0.65 + (height - 1) * UNIT_Y;
    body.scale.set((width - 0.06) / 0.94, bodyHeight / 0.65, (depth - 0.06) / 0.94);
    body.castShadow = !ghost;
    body.receiveShadow = !ghost;
    group.add(body);
    for (let x = 0; x < width; x++) for (let z = 0; z < depth; z++) {
      const stud = new THREE.Mesh(this.stud, this.material(brick.color, ghost));
      stud.position.set(x - (width - 1) / 2, bodyHeight / 2 + 0.045, z - (depth - 1) / 2);
      stud.castShadow = !ghost;
      group.add(stud);
    }
    group.position.set(brick.x + (width - 1) / 2, brick.y * UNIT_Y + 0.38 + (height - 1) * UNIT_Y / 2, brick.z + (depth - 1) / 2);
    group.userData = { id: brick.id, base: group.position.clone(), born: performance.now() };
    return group;
  }
  setWorld(world: World) {
    this.clearGroup(this.scenery, true);
    this.clearGroup(this.robots, true);
    const space = world === 'space';
    const bg = space ? '#152b48' : '#cce6df';
    this.scene.background = new THREE.Color(bg);
    this.scene.fog = new THREE.Fog(bg, 120, 220);
    const ground = new THREE.Mesh(new THREE.CylinderGeometry(17, 18, 0.8, 64),
      this.material(space ? '#536c89' : '#77b798'));
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    this.scenery.add(ground);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(26, 0.3, 22), this.material(space ? '#334e6b' : '#a2c89c'));
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
        this.scenery.add(tree);
      }
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(6, 10, 7), this.material('#7a9c92'));
      mountain.position.set(-16, 2, -20);
      this.scenery.add(mountain);
      const peak = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.8, 7), this.material('#d7ba92'));
      peak.position.set(-16, 6.5, -20);
      this.scenery.add(peak);
    }
    for (const [i, id] of (['build', 'frame', 'detail'] as const).entries()) {
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
      robot.position.set(-5 + i * 5, 0, 8);
      this.robots.add(robot);
    }
    this.resetCamera();
  }
  setBlueprint(bricks: Brick[]) {
    this.clearGroup(this.blueprint);
    for (const brick of bricks) this.blueprint.add(this.brickMesh(brick, true));
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
    for (const [id, mesh] of this.meshes) if (!present.has(id)) {
      this.model.remove(mesh);
      this.meshes.delete(id);
      this.bricks.delete(id);
    }
    for (const brick of bricks) {
      if (this.meshes.has(brick.id)) continue;
      const mesh = this.brickMesh(brick);
      this.model.add(mesh);
      this.meshes.set(brick.id, mesh);
      this.bricks.set(brick.id, brick);
      this.agentTargets.set(brick.agent, new THREE.Vector3(brick.x, 0, Math.min(9, brick.z + 5)));
    }
  }
  explode(value: boolean) { this.exploded = value; }
  resetCamera() {
    this.camera.position.copy(this.cameraTarget).add(new THREE.Vector3(0.55, 0.35, 0.7).normalize().multiplyScalar(this.cameraDistance));
    this.controls.target.copy(this.cameraTarget);
    this.controls.update();
  }
  private animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    const now = performance.now();
    for (const mesh of this.meshes.values()) {
      const base = mesh.userData.base as THREE.Vector3;
      const offset = this.exploded ? new THREE.Vector3(base.x * 0.3, base.y * 0.45 + 1, base.z * 0.5) : new THREE.Vector3();
      const target = base.clone().add(offset);
      if (!this.reduced && now - mesh.userData.born < 320) target.y += 3 * (1 - (now - mesh.userData.born) / 320) ** 3;
      mesh.position.lerp(target, this.reduced ? 1 : 0.2);
    }
    for (const robot of this.robots.children) {
      const target = this.agentTargets.get(robot.name);
      if (target) {
        robot.position.lerp(target, this.reduced ? 1 : 0.025);
        robot.rotation.y = Math.sin(now / 1700) * 0.2;
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
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
    this.cube.dispose();
    this.stud.dispose();
    for (const material of this.materials.values()) material.dispose();
  }
}
