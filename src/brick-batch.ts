import * as THREE from 'three';
import type { Brick } from './engine';

const UNIT_Y = 0.7;
type Entry = { brick: Brick; body: THREE.InstancedMesh; bodyIndex: number; studs: THREE.InstancedMesh; studStart: number; studCells: [number, number][]; born: number };
export const MAX_DECORATIVE_STUDS = 8192;

// Two draw calls per color instead of one body and many stud meshes per brick.
export class BrickBatch {
  readonly group = new THREE.Group();
  private entries: Entry[] = [];
  private active = new Set<Entry>();
  private exploded = false;
  constructor(bricks: Brick[], cube: THREE.BufferGeometry, studGeometry: THREE.BufferGeometry,
    material: (color: string) => THREE.Material, born: Map<string, number>, ghost: boolean, now: number) {
    const colors = new Map<string, Brick[]>();
    for (const brick of bricks) {
      if (!colors.has(brick.color)) colors.set(brick.color, []);
      colors.get(brick.color)!.push(brick);
    }
    const totalStuds = bricks.reduce((sum, b) => sum + (b.width ?? 1) * (b.depth ?? 1), 0);
    const stride = Math.max(1, Math.ceil(totalStuds / MAX_DECORATIVE_STUDS));
    let studOrdinal = 0;
    for (const [color, group] of colors) {
      const studCells = group.map(b => {
        const cells: [number, number][] = [];
        for (let x = 0; x < (b.width ?? 1); x++) for (let z = 0; z < (b.depth ?? 1); z++)
          if (studOrdinal++ % stride === 0) cells.push([x, z]);
        return cells;
      });
      const studCount = studCells.reduce((sum, cells) => sum + cells.length, 0);
      const body = new THREE.InstancedMesh(cube, material(color), group.length);
      const studs = new THREE.InstancedMesh(studGeometry, material(color), studCount);
      body.userData.brickIds = [];
      studs.userData.brickIds = [];
      body.castShadow = studs.castShadow = !ghost;
      body.receiveShadow = !ghost;
      body.frustumCulled = studs.frustumCulled = false;
      let studStart = 0;
      for (const [bodyIndex, brick] of group.entries()) {
        const entry = { brick, body, bodyIndex, studs, studStart, studCells: studCells[bodyIndex], born: born.get(brick.id) ?? 0 };
        this.entries.push(entry);
        body.userData.brickIds.push(brick.id);
        const count = entry.studCells.length;
        for (let i = 0; i < count; i++) studs.userData.brickIds.push(brick.id);
        studStart += count;
        if (!ghost && entry.born && now - entry.born < 320) this.active.add(entry);
        this.place(entry, ghost ? 0 : this.lift(entry, now));
      }
      body.instanceMatrix.needsUpdate = studs.instanceMatrix.needsUpdate = true;
      this.group.add(body, studs);
    }
  }
  private lift(entry: Entry, now: number) {
    return entry.born ? 3 * Math.max(0, 1 - (now - entry.born) / 320) ** 3 : 0;
  }
  private place(entry: Entry, lift: number) {
    const b = entry.brick, width = b.width ?? 1, height = b.height ?? 1, depth = b.depth ?? 1;
    const bodyHeight = 0.65 + (height - 1) * UNIT_Y;
    const x = b.x + (width - 1) / 2, y = b.y * UNIT_Y + 0.38 + (height - 1) * UNIT_Y / 2, z = b.z + (depth - 1) / 2;
    const px = x + (this.exploded ? x * 0.3 : 0), py = y + (this.exploded ? y * 0.45 + 1 : 0) + lift, pz = z + (this.exploded ? z * 0.5 : 0);
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion(),
      new THREE.Vector3((width - 0.06) / 0.94, bodyHeight / 0.65, (depth - 0.06) / 0.94));
    entry.body.setMatrixAt(entry.bodyIndex, matrix);
    let index = entry.studStart;
    for (const [sx, sz] of entry.studCells) {
      entry.studs.setMatrixAt(index++, matrix.makeTranslation(px + sx - (width - 1) / 2, py + bodyHeight / 2 + 0.045, pz + sz - (depth - 1) / 2));
    }
    entry.body.instanceMatrix.needsUpdate = entry.studs.instanceMatrix.needsUpdate = true;
    entry.body.boundingSphere = entry.studs.boundingSphere = null;
  }
  setExploded(value: boolean, now: number) {
    if (this.exploded === value) return;
    this.exploded = value;
    for (const entry of this.entries) this.place(entry, this.active.has(entry) ? this.lift(entry, now) : 0);
  }
  animate(now: number) {
    for (const entry of this.active) {
      this.place(entry, this.lift(entry, now));
      if (now - entry.born >= 320) this.active.delete(entry);
    }
  }
  dispose() {
    for (const mesh of this.group.children) (mesh as THREE.InstancedMesh).dispose();
    this.group.clear();
  }
}
